using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

public sealed record GuideRelease(int SchemaVersion, int Revision, string Name, string Sha256, int Size, int SectionCount, string DownloadPath);
public sealed record GuidePackage(int SchemaVersion, string[] Guides);

public sealed class GuideClient : IDisposable
{
    internal const int MaxBytes = 16 * 1024 * 1024;
    private readonly HttpClient client;
    public GuideClient(string server, string key) : this(server, key, new HttpClientHandler { AllowAutoRedirect = false }) { }
    internal GuideClient(string server, string key, HttpMessageHandler handler)
    {
        if (!Uri.TryCreate(server.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var address) || address.Scheme != "https"
            || address.UserInfo.Length != 0 || address.AbsolutePath != "/" || address.Query.Length != 0 || address.Fragment.Length != 0)
            throw new InvalidOperationException("Укажи HTTPS-адрес сервера без пути.");
        if (!Regex.IsMatch(key, "^dxp_[A-Za-z0-9_-]{43}$")) throw new InvalidOperationException("Введи ключ компьютера из админки.");
        client = new HttpClient(handler) { BaseAddress = address, Timeout = TimeSpan.FromMinutes(2), MaxResponseContentBufferSize = MaxBytes };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(LauncherVersion.UserAgent);
    }

    private static void CheckResponse(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("Ключ компьютера не принят. Проверь ключ в админке.");
        if (response.StatusCode == HttpStatusCode.NotFound) throw new InvalidOperationException("Гайды ещё не опубликованы или версия удалена. Загрузите файл в админке и повторите обновление.");
        if (response.StatusCode == HttpStatusCode.TooManyRequests) throw new InvalidOperationException("Сервер занят. Повтори обновление через минуту.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Не удалось получить гайды. Установленные маршруты сохранены.");
    }

    internal static void Validate(GuideRelease? release)
    {
        if (release is null || release.SchemaVersion != 1 || release.Revision <= 0 || release.SectionCount is < 1 or > 1000
            || release.Size is <= 0 or > MaxBytes || !Regex.IsMatch(release.Sha256 ?? "", "^[a-f0-9]{64}$")
            || release.DownloadPath != $"/api/v1/guides/packages/{release.Sha256}")
            throw new InvalidOperationException("Сервер вернул некорректное описание гайдов.");
    }

    public async Task<GuideRelease> Latest(CancellationToken cancellation)
    {
        using var response = await client.GetAsync("api/v1/guides/latest", cancellation);
        CheckResponse(response);
        var release = await response.Content.ReadFromJsonAsync<GuideRelease>(cancellation);
        Validate(release);
        return release!;
    }

    public async Task<byte[]> Download(GuideRelease release, CancellationToken cancellation)
    {
        Validate(release);
        using var response = await client.GetAsync(release.DownloadPath, HttpCompletionOption.ResponseHeadersRead, cancellation);
        CheckResponse(response);
        if (response.Content.Headers.ContentLength is long size && size != release.Size)
            throw new InvalidOperationException("Размер гайдов не совпал. Повтори загрузку.");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellation);
        using var output = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(buffer, cancellation)) > 0)
        {
            if (output.Length + read > release.Size) throw new InvalidOperationException("Сервер прислал слишком большой файл гайдов.");
            output.Write(buffer, 0, read);
        }
        var bytes = output.ToArray();
        GuideFiles.Verify(release, bytes);
        return bytes;
    }
    public void Dispose() => client.Dispose();
}

public static class GuideFiles
{
    internal const string RelativePath = "UserGuides/ForeverHorde.lua";

    internal static bool SupportsUpdates(string addon)
    {
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(addon, "build.json")));
        return manifest.RootElement.GetProperty("addon").GetString() == "DiscodicXP"
            && manifest.RootElement.TryGetProperty("guideUpdates", out var capability) && capability.TryGetInt32(out var value) && value == 1;
    }

    public static void ValidateInstallation(string addonsPath)
    {
        var addon = Path.Combine(AddonInstaller.ValidateAddOns(addonsPath), "DiscodicXP");
        AddonInstaller.RejectLinks(addon);
        AddonInstaller.RejectLinks(Path.Combine(addon, "UserGuides"));
        var file = Path.Combine(addon, RelativePath);
        if (!Directory.Exists(addon) || !File.Exists(Path.Combine(addon, "build.json")) || !SupportsUpdates(addon)
            || !File.Exists(file) || !File.Exists(Path.Combine(addon, "DiscodicXP.toc"))
            || !File.ReadLines(Path.Combine(addon, "DiscodicXP.toc")).Any(line => line.Trim().Replace('\\', '/') == RelativePath))
            throw new InvalidOperationException("Сначала обнови аддон до версии с обновлением гайдов через лаунчер и перезапусти WoW.");
        RejectFileLink(file);
    }

    private static void RejectFileLink(string file)
    {
        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Файл гайдов не должен быть ссылкой.");
    }

    internal static void Verify(GuideRelease release, byte[] bytes)
    {
        GuideClient.Validate(release);
        if (bytes.Length != release.Size || !Convert.ToHexString(SHA256.HashData(bytes)).Equals(release.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Файл гайдов повреждён. Прежние маршруты сохранены, повтори загрузку.");
    }

    internal static string ToLua(GuideRelease release, byte[] bytes)
    {
        Verify(release, bytes);
        var package = JsonSerializer.Deserialize<GuidePackage>(bytes, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (package is null || package.SchemaVersion != 1 || package.Guides is null || package.Guides.Length != release.SectionCount)
            throw new InvalidOperationException("Не удалось прочитать разделы гайда.");
        var result = new StringBuilder($"local _, addon = ...\naddon.launcherGuideDigest = \"{release.Sha256}\"\n\n");
        foreach (var guide in package.Guides)
        {
            if (string.IsNullOrWhiteSpace(guide) || guide.Contains('\0') || !Regex.IsMatch(guide, @"^#name\s+[^\r\n]+", RegexOptions.Multiline)
                || !Regex.IsMatch(guide, @"^#group\s+[^\r\n]+", RegexOptions.Multiline)
                || !Regex.IsMatch(guide, @"^#forever\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)
                || !Regex.IsMatch(guide, @"^\s*step(?:\s|$)", RegexOptions.Multiline)
                || Regex.IsMatch(guide, @"^\s*#\S+\s*=", RegexOptions.Multiline))
                throw new InvalidOperationException("В пакете найден некорректный маршрут.");
            var separator = "";
            while (guide.Contains("]" + separator + "]", StringComparison.Ordinal)) separator += "=";
            result.Append("addon.DiscodicXP.RegisterGuide([").Append(separator).Append("[\n").Append(guide).Append(']').Append(separator).Append("])\n\n");
        }
        return result.ToString();
    }

    public static bool Install(string addonsPath, GuideRelease release, byte[] bytes)
    {
        var text = ToLua(release, bytes);
        ValidateInstallation(addonsPath);
        var target = Path.Combine(AddonInstaller.ValidateAddOns(addonsPath), "DiscodicXP", RelativePath);
        if (File.ReadAllText(target) == text) return false;
        var stamp = Guid.NewGuid().ToString("N");
        var temporary = target + ".stage-" + stamp;
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var encoded = new UTF8Encoding(false, true).GetBytes(text);
                output.Write(encoded);
                output.Flush(true);
            }
            ValidateInstallation(addonsPath);
            File.Replace(temporary, target, target + ".backup-" + stamp);
            return true;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal static void Preserve(string previous, string staging)
    {
        if (!Directory.Exists(previous) || !SupportsUpdates(previous) || !SupportsUpdates(staging)) return;
        AddonInstaller.RejectLinks(Path.Combine(previous, "UserGuides"));
        var file = Path.Combine(previous, RelativePath);
        if (!File.Exists(file)) return;
        RejectFileLink(file);
        File.Copy(file, Path.Combine(staging, RelativePath), true);
    }
}
