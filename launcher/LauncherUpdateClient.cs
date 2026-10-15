using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

public static class LauncherVersion
{
    public static string Current => typeof(App).Assembly.GetName().Version!.ToString(3);
    public static string UserAgent => $"DiscodicXP-Launcher/{Current}";
}

public sealed record LauncherRelease(string Version, string Sha256, long Size, string DownloadPath)
{
    public bool IsNewer => System.Version.Parse(Version) > System.Version.Parse(LauncherVersion.Current);
    public void Validate()
    {
        if (!Regex.IsMatch(Version ?? "", @"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
            || !System.Version.TryParse(Version, out _) || !Regex.IsMatch(Sha256 ?? "", "^[a-f0-9]{64}$")
            || Size is <= 0 or > 128 * 1024 * 1024 || DownloadPath != $"/downloads/launcher/{Sha256}.exe")
            throw new InvalidOperationException("Сервер вернул некорректное описание обновления лаунчера.");
    }
}

public sealed class LauncherUpdateClient : IDisposable
{
    private readonly HttpClient client;
    public LauncherUpdateClient() : this(new HttpClientHandler { AllowAutoRedirect = false }) { }
    internal LauncherUpdateClient(HttpMessageHandler handler)
    {
        client = new HttpClient(handler)
        {
            BaseAddress = new Uri(LauncherSettings.DefaultServer), Timeout = TimeSpan.FromMinutes(15),
            MaxResponseContentBufferSize = 16384
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(LauncherVersion.UserAgent);
    }
    private static void CheckResponse(HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Не удалось получить обновление лаунчера. Повтори позже.");
    }
    public async Task<LauncherRelease> Latest(CancellationToken cancellation)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var response = await client.GetAsync("/downloads/launcher/latest.json", timeout.Token);
        CheckResponse(response);
        var release = await response.Content.ReadFromJsonAsync<LauncherRelease>(timeout.Token)
            ?? throw new InvalidOperationException("Сервер вернул пустое описание обновления лаунчера.");
        release.Validate();
        return release;
    }
    public async Task Download(LauncherRelease release, string destination, IProgress<int> progress, CancellationToken cancellation)
    {
        release.Validate();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromMinutes(15));
        cancellation = timeout.Token;
        var created = false;
        try
        {
            using var response = await client.GetAsync(release.DownloadPath, HttpCompletionOption.ResponseHeadersRead, cancellation);
            CheckResponse(response);
            if (response.Content.Headers.ContentLength is long length && length != release.Size)
                throw new InvalidOperationException("Размер обновления лаунчера не совпадает с описанием.");
            await using var source = await response.Content.ReadAsStreamAsync(cancellation);
            await using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
            {
                created = true;
                using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await source.ReadAsync(buffer, cancellation)) > 0)
                {
                    total += read;
                    if (total > release.Size) throw new InvalidOperationException("Обновление лаунчера превышает заявленный размер.");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellation);
                    progress.Report((int)(total * 100 / release.Size));
                }
                if (total != release.Size || !Convert.ToHexString(hash.GetHashAndReset()).Equals(release.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Обновление лаунчера повреждено. Текущая версия сохранена.");
                await output.FlushAsync(cancellation);
                output.Flush(true);
            }
        }
        catch
        {
            if (created) File.Delete(destination);
            throw;
        }
    }
    public void Dispose() => client.Dispose();
}
