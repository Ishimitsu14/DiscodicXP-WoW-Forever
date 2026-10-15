using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using DiscodicXP.Launcher;

internal static class ProgressChecks
{
    public static void RunServer(string root, string address, string credentialsPath, Action<bool, string> check)
    {
        var uri = new Uri(address);
        if (!uri.IsLoopback || uri.Scheme != "http") throw new InvalidOperationException("Integration server must use loopback HTTP.");
        using var credentials = JsonDocument.Parse(File.ReadAllText(credentialsPath));
        var token = credentials.RootElement.GetProperty("token").GetString()!;
        var firstPath = Path.Combine(root, "integration-first.lua");
        var secondPath = Path.Combine(root, "integration-second.lua");
        File.WriteAllText(firstPath, Content(41)); File.WriteAllText(secondPath, Content(1));
        var identity = SavedVariables.Identity(Content(1));
        var first = new LocalCharacter(firstPath, "TEST_1", identity);
        var second = new LocalCharacter(secondPath, "TEST_1", identity);
        using var client = new ProgressClient("https://integration.invalid", token, new LoopbackHandler(uri));
        var sync = new ProgressSync(Path.Combine(root, "integration-state.json"));
        var upload = sync.Plan(client, first, false, default).GetAwaiter().GetResult();
        check(!upload.Download, "real server accepts new character upload plan");
        sync.Apply(client, upload, default).GetAwaiter().GetResult();
        var download = sync.Plan(client, second, false, default).GetAwaiter().GetResult();
        check(download.Download && download.Remote?.Revision == 1, "real server exposes uploaded character to another computer");
        sync.Apply(client, download, default).GetAwaiter().GetResult();
        check(File.ReadAllText(secondPath) == Content(41), "real Node server and C# launcher preserve exact per-character data");
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

    public static void RunDiscovery(string root, Action<bool, string> check, Action<Action, string> throws)
    {
        var addons = Path.Combine(root, "discovery", "Interface", "AddOns");
        Directory.CreateDirectory(addons);
        Save(addons, "Тест", Content(1));
        Save(addons, "Старый", "DXPCData={currentStep=2}");
        check(ProgressFiles.Scan(addons).Single().Identity.Name == "Тест", "named realm discovery skips older saves without identity");
        var numberedPath = Save(addons, "Djon-Garik", Content(7, "Player-4613-01878906", "Djon")
            .Replace("Хроми", "Classic Beta PvP 2"), "70");
        var numbered = ProgressFiles.Scan(addons).Single(item => item.Identity.Name == "Djon");
        check(numbered.Path == numberedPath && numbered.Identity.Realm == "Classic Beta PvP 2",
            "numbered realm and character-home realm folder use saved identity");
        Save(addons, "Другой", Content(2, "Player-1-OTHER", "Другой"), "70");
        check(ProgressFiles.Scan(addons).Count == 3, "numbered realm also accepts a plain character folder");
        File.WriteAllText(numberedPath, Content(7, "Player-4613-01878906", "Other").Replace("Хроми", "Classic Beta PvP 2"));
        throws(() => ProgressFiles.Scan(addons), "numbered realm still rejects a different character name");
        File.Delete(numberedPath);
        Save(addons, "Тест", Content(1).Replace("Хроми", "Другой сервер"));
        throws(() => ProgressFiles.Scan(addons), "named realm still rejects a different realm");
    }

    public static void Run(string root, Action<bool, string> check, Action<Action, string> throws)
    {
        RunDiscovery(root, check, throws);
        var watcher = new GameSessionWatcher(false);
        check(!watcher.ShouldSave(false, true, false) && !watcher.ShouldSave(true, true, false), "auto-save waits for game exit");
        check(watcher.ShouldSave(false, true, false) && !watcher.ShouldSave(false, true, false), "game exit schedules exactly one auto-save");
        watcher.ShouldSave(true, true, false);
        check(!watcher.ShouldSave(false, true, true) && watcher.ShouldSave(false, true, false), "auto-save waits for an in-progress operation");
        watcher.ShouldSave(true, true, false);
        check(!watcher.ShouldSave(false, false, false), "disabled auto-save performs no operation");
        var firstAddons = Path.Combine(root, "computer-one", "Interface", "AddOns");
        var secondAddons = Path.Combine(root, "computer-two", "Interface", "AddOns");
        Directory.CreateDirectory(firstAddons); Directory.CreateDirectory(secondAddons);
        var firstPath = Save(firstAddons, "Тест", Content(12));
        Save(firstAddons, "Старый", "DXPCData={currentStep=2}");
        var secondPath = Save(secondAddons, "Тест", Content(1));
        var otherPath = Save(secondAddons, "Другой", Content(5, "Player-1-OTHER", "Другой"));
        var first = ProgressFiles.Scan(firstAddons).Single();
        var second = ProgressFiles.Scan(secondAddons).Single(item => item.Identity.Name == "Тест");
        check(first.Identity.Guid == "Player-1-ABC", "character discovered from actual WTF layout");
        check(ProgressFiles.Scan(firstAddons).Count == 1, "older characters without identity do not block an updated character");
        var identity = SavedVariables.Identity(Content(1).Replace("Тест", "\\208\\162\\208\\181\\209\\129\\209\\130"));
        check(identity.Name == "Тест", "Lua byte escapes decode as UTF-8");
        foreach (var malicious in new[] { "DXPCData = os.execute('bad')", Content(1) + "os.execute('bad')", Content(1) + " Other = {}", Content(1).Replace("currentStep=1", "currentStep=1+1") })
            throws(() => SavedVariables.Parse(malicious), "executable and foreign Lua rejected");
        throws(() => ProgressFiles.Restore(second, Content(2), ProgressFiles.Hash(Content(1)), () => true), "restore blocked while game runs");
        throws(() => ProgressFiles.Restore(second, Content(2, "Player-2-WRONG"), ProgressFiles.Hash(Content(1)), () => false), "foreign character cannot overwrite progress");
        throws(() => ProgressFiles.Restore(second, Content(2), "stale hash", () => false), "concurrent local edits protected");
        var backup = ProgressFiles.Restore(second, Content(2), ProgressFiles.Hash(Content(1)), () => false);
        check(File.ReadAllText(backup) == Content(1) && File.ReadAllText(secondPath) == Content(2), "restore atomically retains previous file");
        File.WriteAllText(secondPath, Content(1));
        using var client = new ProgressClient("https://sync.example.com", "dxp_" + new string('a', 43), new CloudHandler());
        var firstSync = new ProgressSync(Path.Combine(root, "first-state.json"));
        var secondState = Path.Combine(root, "second-state.json");
        var secondSync = new ProgressSync(secondState);
        var one = firstSync.Plan(client, first, false, default).GetAwaiter().GetResult();
        check(!one.Download && one.BaseRevision == 0, "first computer plans initial upload");
        firstSync.Apply(client, one, default).GetAwaiter().GetResult();
        var unchanged = firstSync.Plan(client, first, false, default).GetAwaiter().GetResult();
        check(unchanged.Unchanged, "unchanged progress does not create another revision");
        firstSync.Apply(client, unchanged, default).GetAwaiter().GetResult();
        var two = secondSync.Plan(client, second, false, default).GetAwaiter().GetResult();
        check(two.Download && two.Remote?.Revision == 1, "new computer plans cloud restore");
        secondSync.Apply(client, two, default).GetAwaiter().GetResult();
        check(File.ReadAllText(secondPath) == Content(12), "second computer receives full progress including checks and tracking");
        check(File.ReadAllText(otherPath) == Content(5, "Player-1-OTHER", "Другой"), "other character remains unchanged");
        File.WriteAllText(secondPath, Content(18));
        secondSync = new ProgressSync(secondState);
        var later = secondSync.Plan(client, second, false, default).GetAwaiter().GetResult();
        check(!later.Download && later.BaseRevision == 1, "baseline survives launcher restart");
        secondSync.Apply(client, later, default).GetAwaiter().GetResult();
        File.WriteAllText(firstPath, Content(15));
        throws(() => firstSync.Plan(client, first, false, default).GetAwaiter().GetResult(), "divergent computer progress triggers conflict");
        var forced = firstSync.Plan(client, first, true, default).GetAwaiter().GetResult();
        firstSync.Apply(client, forced, default).GetAwaiter().GetResult();
        check(File.ReadAllText(firstPath) == Content(18), "explicit cloud restore resolves divergence");
        var changed = firstSync.Plan(client, first, true, default).GetAwaiter().GetResult();
        File.WriteAllText(firstPath, Content(19));
        throws(() => firstSync.Apply(client, changed, default).GetAwaiter().GetResult(), "file edits after planning cancel apply");
    }

    private static string Save(string addons, string name, string content, string realm = "Хроми")
    {
        var path = Path.Combine(Directory.GetParent(addons)!.Parent!.FullName, "WTF", "Account", "TEST_1", realm, name, "SavedVariables", "DiscodicXP.lua");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!); File.WriteAllText(path, content); return path;
    }

    private static string Content(int step, string guid = "Player-1-ABC", string name = "Тест") =>
        $"-- SavedVariables\nDXPCData = {{syncIdentity={{guid=\"{guid}\",name=\"{name}\",realm=\"Хроми\"}},currentStep={step},currentGuideName=\"Маршрут\",guideProgress={{[\"key\"]={{step={step},stepId=\"stable\"}}}},stepSkip={{[2]=true}},completedWaypoints={{[3]=true}}}}\nDXPCTrackingData = {{xp=123}}\nDXPCComms = nil\nDXPCSettings = {{}}";

    private sealed class CloudHandler : HttpMessageHandler
    {
        private int revision;
        private string content = "";
        private CloudCharacter Character => new("character-id", "Player-1-ABC", "Тест", "Хроми", revision, "Маршрут", 12);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            object result;
            if (request.RequestUri!.AbsolutePath == "/api/v1/account") result = new CloudAccount("account-id", "Test#1234");
            else if (request.Method == HttpMethod.Post)
            {
                var input = await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken);
                if (input.GetProperty("baseRevision").GetInt32() != revision) return new HttpResponseMessage(HttpStatusCode.Conflict);
                content = input.GetProperty("content").GetString()!; revision++; result = Character;
            }
            else if (request.RequestUri.AbsolutePath.EndsWith("/snapshot")) result = new CloudSnapshot(1, Character, revision, content);
            else result = revision == 0 ? Array.Empty<CloudCharacter>() : new[] { Character };
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(result) };
        }
    }
}
