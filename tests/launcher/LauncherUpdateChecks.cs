using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using DiscodicXP.Launcher;

internal static class LauncherUpdateChecks
{
    public static void Run(string root, Action<bool, string> check, Action<Action, string> throws, string? package = null, string? previous = null)
    {
        var bytes = "MZ-launcher-test"u8.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var release = new LauncherRelease("1.0.0", hash, bytes.Length, $"/downloads/launcher/{hash}.exe");
        using var client = new LauncherUpdateClient(new Handler(request =>
        {
            check(request.Headers.Authorization is null && request.RequestUri!.GetLeftPart(UriPartial.Authority) == LauncherSettings.DefaultServer,
                "launcher updates use the fixed HTTPS server without account credentials");
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = request.RequestUri!.AbsolutePath.EndsWith("latest.json") ? JsonContent.Create(release) : new ByteArrayContent(bytes)
            };
        }));
        check(client.Latest(default).GetAwaiter().GetResult() == release && release.IsNewer, "launcher manifest version is detected");
        check(!(release with { Version = LauncherVersion.Current }).IsNewer, "current launcher version is not downloaded again");
        foreach (var invalid in new[] { release with { DownloadPath = "https://other.example/launcher.exe" }, release with { Size = 0 },
            release with { Sha256 = "bad" }, release with { Version = "1.0.0-preview" }, release with { Size = 129 * 1024 * 1024 } })
            throws(invalid.Validate, "unsafe launcher manifest rejected");
        var destination = Path.Combine(root, "download.exe");
        client.Download(release, destination, new QuietProgress(), default).GetAwaiter().GetResult();
        check(File.ReadAllBytes(destination).SequenceEqual(bytes), "launcher payload streams to disk and verifies SHA-256");
        throws(() => client.Download(release, destination, new QuietProgress(), default).GetAwaiter().GetResult(), "existing download cannot be overwritten");
        check(File.ReadAllBytes(destination).SequenceEqual(bytes), "failed download preserves an existing file");
        var corrupt = Path.Combine(root, "corrupt.exe");
        using var badClient = new LauncherUpdateClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent("MZ-launcher-fake"u8.ToArray()) }));
        throws(() => badClient.Download(release, corrupt, new QuietProgress(), default).GetAwaiter().GetResult(), "modified executable rejected");
        check(!File.Exists(corrupt), "unverified executable is removed");
        using var redirect = new LauncherUpdateClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.Redirect)));
        throws(() => redirect.Latest(default).GetAwaiter().GetResult(), "launcher manifest redirects rejected");
        var installer = new LauncherUpdateInstaller(Path.Combine(root, "jobs"));
        throws(() => installer.DownloadPath("../outside"), "updater job cannot escape its directory");
        if (package is null || previous is null) return;
        var actualRelease = new LauncherRelease(LauncherVersion.Current, LauncherUpdateInstaller.Hash(package), new FileInfo(package).Length,
            $"/downloads/launcher/{LauncherUpdateInstaller.Hash(package)}.exe");
        var target = Path.Combine(root, "Launcher (downloaded copy).exe");
        File.Copy(previous, target);
        var previousHash = LauncherUpdateInstaller.Hash(target);
        var unrelated = Path.Combine(root, "settings.json");
        File.WriteAllText(unrelated, "settings remain separate");
        var id = installer.CreateJob();
        File.Copy(package, installer.DownloadPath(id));
        var job = installer.Prepare(id, actualRelease, target);
        installer.Install(job, () => Task.CompletedTask).GetAwaiter().GetResult();
        check(LauncherUpdateInstaller.Hash(target) == actualRelease.Sha256, "exe is replaced in its original path, including spaces");
        check(File.ReadAllText(unrelated) == "settings remain separate", "launcher replacement preserves settings");
        var rollbackId = installer.CreateJob();
        File.Copy(package, installer.DownloadPath(rollbackId));
        File.Copy(previous, target, true);
        var rollback = installer.Prepare(rollbackId, actualRelease, target);
        throws(() => installer.Install(rollback, () => throw new InvalidOperationException("Simulated restart failure")).GetAwaiter().GetResult(), "restart failure reports an error");
        check(LauncherUpdateInstaller.Hash(target) == previousHash, "restart failure atomically restores the previous executable");
        var changedId = installer.CreateJob();
        File.Copy(package, installer.DownloadPath(changedId));
        var changed = installer.Prepare(changedId, actualRelease, target);
        File.AppendAllText(target, "external edit");
        var editedHash = LauncherUpdateInstaller.Hash(target);
        throws(() => installer.Install(changed, () => Task.CompletedTask).GetAwaiter().GetResult(), "concurrent executable changes cancel replacement");
        check(LauncherUpdateInstaller.Hash(target) == editedHash, "concurrent changes are preserved");
        throws(() => installer.Prepare(changedId, actualRelease with { Version = "8.0.0" }, target), "embedded executable version must match the manifest");
        installer.DeleteJob(changedId);
        check(!Directory.Exists(Path.GetDirectoryName(installer.DownloadPath(changedId))), "job cleanup stays inside the allocated update folder");
    }

    private sealed class QuietProgress : IProgress<int> { public void Report(int value) { } }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request));
    }
}
