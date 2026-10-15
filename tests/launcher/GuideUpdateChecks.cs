using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DiscodicXP.Launcher;

internal static class GuideUpdateChecks
{
    public static void RunServer(string address, string credentialsPath, string sourceAddon, string addons, Action<bool, string> check)
    {
        var uri = new Uri(address);
        if (!uri.IsLoopback || uri.Scheme != "http") throw new InvalidOperationException("Integration server must use loopback HTTP.");
        using var credentials = JsonDocument.Parse(File.ReadAllText(credentialsPath));
        var token = credentials.RootElement.GetProperty("token").GetString()!;
        using var client = new GuideClient("https://integration.invalid", token, new LoopbackHandler(uri));
        var release = client.Latest(default).GetAwaiter().GetResult();
        var bytes = client.Download(release, default).GetAwaiter().GetResult();
        var target = Path.Combine(addons, "DiscodicXP");
        if (Directory.Exists(target)) throw new InvalidOperationException("Choose a new integration output directory.");
        foreach (var file in Directory.EnumerateFiles(sourceAddon, "*", SearchOption.AllDirectories))
        {
            var destination = Path.Combine(target, Path.GetRelativePath(sourceAddon, file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination);
        }
        GuideFiles.Install(addons, release, bytes);
        check(!GuideFiles.Install(addons, release, bytes), "real Node package installs once and remains idempotent");
        check(File.ReadAllText(Path.Combine(target, GuideFiles.RelativePath)).Contains(release.Sha256), "real server and C# launcher agree on guide integrity");
        Console.WriteLine($"Guide server integration: revision {release.Revision}, sections {release.SectionCount}");
    }

    private sealed class LoopbackHandler(Uri address) : HttpMessageHandler
    {
        private readonly HttpMessageInvoker http = new(new HttpClientHandler { AllowAutoRedirect = false });
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.RequestUri = new Uri(address, request.RequestUri!.PathAndQuery);
            return http.SendAsync(request, cancellationToken);
        }
        protected override void Dispose(bool disposing) { if (disposing) http.Dispose(); base.Dispose(disposing); }
    }

    public static void Run(string root, Action<bool, string> check, Action<Action, string> throws)
    {
        var source = "#forever\n#group Demo\n#name Test\nstep\n.accept 123 >>Тест ]] ]=] ]==]\n";
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, guides = new[] { source } });
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var release = new GuideRelease(1, 1, "Guide.txt", hash, bytes.Length, 1, "/api/v1/guides/packages/" + hash);
        var addons = Path.Combine(root, "guide-client", "Interface", "AddOns");
        var addon = Path.Combine(addons, "DiscodicXP");
        Directory.CreateDirectory(Path.Combine(addon, "UserGuides"));
        File.WriteAllText(Path.Combine(addon, "build.json"), "{\"addon\":\"DiscodicXP\",\"version\":\"0.5.0\",\"interface\":16001,\"guideUpdates\":1}");
        File.WriteAllText(Path.Combine(addon, "DiscodicXP.toc"), "## Interface: 16001\nUserGuides/ForeverHorde.lua\n");
        var file = Path.Combine(addon, "UserGuides", "ForeverHorde.lua");
        File.WriteAllText(file, "original guide");
        var saved = Path.Combine(root, "guide-client", "WTF", "progress.lua");
        Directory.CreateDirectory(Path.GetDirectoryName(saved)!);
        File.WriteAllText(saved, "saved character progress");
        check(GuideFiles.Install(addons, release, bytes), "guide package installs independently of the full addon installer");
        var lua = File.ReadAllText(file);
        check(lua.Contains("[===[\n" + source + "]===]") && lua.Contains(hash), "Lua delimiters preserve Unicode and embedded closing brackets without executing text");
        check(Directory.GetFiles(Path.GetDirectoryName(file)!, "*.backup-*").Length == 1, "guide update keeps the previous file as a backup");
        check(!GuideFiles.Install(addons, release, bytes), "same guide package is idempotent");
        check(File.ReadAllText(saved) == "saved character progress", "guide installation never rewrites WTF progress");
        var damaged = bytes.ToArray(); damaged[0] ^= 1;
        throws(() => GuideFiles.Install(addons, release, damaged), "corrupted guide bytes rejected");
        throws(() => GuideFiles.Install(addons, release with { DownloadPath = "https://foreign.invalid/file" }, bytes), "foreign package URL rejected");
        throws(() => GuideFiles.Install(addons, release with { SectionCount = 2 }, bytes), "section count mismatch rejected");
        var invalid = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, guides = new[] { source + "#code = os.execute('bad')\n" } });
        var invalidHash = Convert.ToHexString(SHA256.HashData(invalid)).ToLowerInvariant();
        throws(() => GuideFiles.Install(addons, release with { Sha256 = invalidHash, Size = invalid.Length, DownloadPath = "/api/v1/guides/packages/" + invalidHash }, invalid), "executable guide directives rejected");
        check(File.ReadAllText(file) == lua, "failed validation preserves the installed guide");

        var prepared = Path.Combine(root, "guide-upgrade");
        Directory.CreateDirectory(Path.Combine(prepared, "UserGuides"));
        File.WriteAllText(Path.Combine(prepared, "build.json"), "{\"addon\":\"DiscodicXP\",\"version\":\"0.5.1\",\"interface\":16001,\"guideUpdates\":1}");
        File.WriteAllText(Path.Combine(prepared, "DiscodicXP.toc"), "UserGuides/ForeverHorde.lua\n");
        File.WriteAllText(Path.Combine(prepared, "UserGuides", "ForeverHorde.lua"), "bundled guide");
        AddonInstaller.Install(addons, prepared, "0.5.1");
        check(File.ReadAllText(file) == lua, "full addon upgrade preserves guides previously delivered by the launcher");
        File.WriteAllText(Path.Combine(addon, "build.json"), "{\"addon\":\"DiscodicXP\",\"version\":\"0.4.1\"}");
        throws(() => GuideFiles.Install(addons, release, bytes), "legacy addon must be upgraded before live guide delivery");
        check(File.ReadAllText(file) == lua, "legacy installation is not changed");

        using var client = new GuideClient("https://test.invalid", "dxp_" + new string('g', 43), new Handler(release, bytes));
        var latest = client.Latest(default).GetAwaiter().GetResult();
        check(latest == release, "launcher reads guide metadata with the device key");
        check(client.Download(latest, default).GetAwaiter().GetResult().SequenceEqual(bytes), "launcher downloads and verifies the complete package");
        using var broken = new GuideClient("https://test.invalid", "dxp_" + new string('g', 43), new Handler(release, damaged));
        throws(() => broken.Download(release, default).GetAwaiter().GetResult(), "HTTP package checksum failure is rejected");
    }

    private sealed class Handler(GuideRelease release, byte[] bytes) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Headers.Authorization?.Scheme != "Bearer") throw new InvalidOperationException("Missing device key.");
            var content = request.RequestUri!.AbsolutePath.EndsWith("/latest", StringComparison.Ordinal)
                ? JsonSerializer.SerializeToUtf8Bytes(release, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }) : bytes;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(content) });
        }
    }
}
