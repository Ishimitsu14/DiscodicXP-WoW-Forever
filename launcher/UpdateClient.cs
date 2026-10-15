using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

public sealed record ReleaseInfo(string Version, string Tag, string Sha256, long Size, string DownloadPath);

public sealed class UpdateClient : IDisposable
{
    private const long MaxPackageBytes = 64 * 1024 * 1024;
    private readonly HttpClient client;

    public UpdateClient(string server, string deviceKey)
    {
        if (!Uri.TryCreate(server.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var address)
            || address.Scheme != "https" || address.UserInfo.Length != 0 || address.AbsolutePath != "/"
            || address.Query.Length != 0 || address.Fragment.Length != 0)
            throw new InvalidOperationException("Укажи HTTPS-адрес сервера без пути, например https://updates.example.com.");
        if (!Regex.IsMatch(deviceKey, @"^dxp_[A-Za-z0-9_-]{43}$"))
            throw new InvalidOperationException("Введи ключ компьютера, выданный сервером обновлений.");
        client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = address,
            Timeout = TimeSpan.FromMinutes(3)
        };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", deviceKey);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("DiscodicXP-Launcher/0.1.0");
    }

    private static void CheckResponse(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new InvalidOperationException("Ключ компьютера не принят. Проверь ключ или создай новый на сервере.");
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
            throw new InvalidOperationException("Сервер занят. Повтори попытку через минуту.");
        if (response.StatusCode == HttpStatusCode.ServiceUnavailable)
            throw new InvalidOperationException("Сервер пока не получил готовую сборку из GitHub. Повтори попытку позже.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Не удалось получить обновление от сервера.");
    }

    public async Task<ReleaseInfo> Latest(CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync("v1/releases/latest", cancellationToken);
        CheckResponse(response);
        var info = await response.Content.ReadFromJsonAsync<ReleaseInfo>(cancellationToken);
        if (info is null || !Regex.IsMatch(info.Version ?? "", @"^\d+\.\d+\.\d+$")
            || !Regex.IsMatch(info.Sha256 ?? "", "^[a-f0-9]{64}$")
            || info.Size is <= 0 or > MaxPackageBytes || info.DownloadPath != $"/v1/packages/{info.Sha256}.zip")
            throw new InvalidOperationException("Сервер вернул некорректное описание обновления.");
        return info;
    }

    public async Task Download(ReleaseInfo info, string destination, IProgress<int> progress, CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync(info.DownloadPath, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        CheckResponse(response);
        if (response.Content.Headers.ContentLength is long length && length != info.Size)
            throw new InvalidOperationException("Размер архива не совпадает с описанием обновления.");
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
        {
            total += read;
            if (total > info.Size) throw new InvalidOperationException("Сервер прислал слишком большой архив.");
            hash.AppendData(buffer, 0, read);
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            progress.Report((int)(total * 100 / info.Size));
        }
        if (total != info.Size || !Convert.ToHexString(hash.GetHashAndReset()).Equals(info.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Архив повреждён. Установленная версия сохранена, повтори загрузку.");
    }

    public void Dispose() => client.Dispose();
}
