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

public sealed record CharacterIdentity(string Guid, string Name, string Realm);
public sealed record LocalCharacter(string Path, string AccountFolder, CharacterIdentity Identity)
{
    public string Label => $"{Identity.Name} · {Identity.Realm} · {AccountFolder}";
}
public sealed record CloudAccount(string Id, string BattleTag);
public sealed record CloudCharacter(string Id, string Guid, string Name, string Realm, int Revision, string Guide, int Step);
public sealed record CloudSnapshot(int SchemaVersion, CloudCharacter Character, int Revision, string Content);
public sealed record SyncState(int Revision, string Hash);
public sealed record SyncPlan(LocalCharacter Local, CloudCharacter? Remote, CloudAccount Account, string Content, string StateKey, int BaseRevision, bool Download, bool Unchanged = false);

public sealed class GameSessionWatcher(bool running)
{
    private bool wasRunning = running;
    private bool pending;
    public bool ShouldSave(bool gameRunning, bool enabled, bool busy)
    {
        if (wasRunning && !gameRunning && enabled) pending = true;
        wasRunning = gameRunning;
        if (!enabled) pending = false;
        if (!pending || gameRunning || busy) return false;
        pending = false;
        return true;
    }
}

public sealed class ProgressClient : IDisposable
{
    private readonly HttpClient client;
    public string Server { get; }
    public ProgressClient(string server, string key) : this(server, key, new HttpClientHandler { AllowAutoRedirect = false }) { }
    internal ProgressClient(string server, string key, HttpMessageHandler handler)
    {
        if (!Uri.TryCreate(server.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("Укажи HTTPS-адрес сервера без пути.");
        if (!Regex.IsMatch(key, "^dxp_[A-Za-z0-9_-]{43}$")) throw new InvalidOperationException("Введи ключ компьютера из админки.");
        Server = uri.GetLeftPart(UriPartial.Authority);
        client = new HttpClient(handler) { BaseAddress = uri, Timeout = TimeSpan.FromSeconds(60), MaxResponseContentBufferSize = 16 * 1024 * 1024 };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(LauncherVersion.UserAgent);
    }
    private async Task<T> Read<T>(HttpResponseMessage response, CancellationToken cancellation)
    {
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.Conflict) throw new InvalidOperationException("На сервере уже есть более новое сохранение. Загрузи его перед продолжением; локальный прогресс будет сохранён в резервной копии.");
            if (response.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("Ключ не принят. Нужен активный ключ компьютера из новой админки.");
            if (response.StatusCode == HttpStatusCode.TooManyRequests) throw new InvalidOperationException("Слишком много запросов. Повтори через минуту.");
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Сервер не смог обработать прогресс. Локальные данные сохранены.");
            return await response.Content.ReadFromJsonAsync<T>(cancellation) ?? throw new InvalidOperationException("Сервер вернул пустой ответ.");
        }
    }
    public async Task<CloudAccount> Account(CancellationToken cancellation) => await Read<CloudAccount>(await client.GetAsync("api/v1/account", cancellation), cancellation);
    public async Task<CloudCharacter[]> Characters(CancellationToken cancellation) => await Read<CloudCharacter[]>(await client.GetAsync("api/v1/characters", cancellation), cancellation);
    public async Task<CloudSnapshot> Download(string id, CancellationToken cancellation) => await Read<CloudSnapshot>(await client.GetAsync($"api/v1/characters/{Uri.EscapeDataString(id)}/snapshot", cancellation), cancellation);
    public async Task<CloudCharacter> Upload(SyncPlan plan, CancellationToken cancellation) => await Read<CloudCharacter>(await client.PostAsJsonAsync("api/v1/snapshots",
        new { schemaVersion = 1, character = plan.Local.Identity, content = plan.Content, baseRevision = plan.BaseRevision }, cancellation), cancellation);
    public void Dispose() => client.Dispose();
}

public static class ProgressFiles
{
    public static void EnsureClosed()
    {
        if (AddonInstaller.GameIsRunning()) throw new InvalidOperationException("Закрой WoW перед синхронизацией: игра должна записать прогресс на диск.");
    }
    private static void RejectLinks(string path)
    {
        for (var current = Path.GetFullPath(path); current is not null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Папка прогресса не должна содержать ссылки или junction.");
    }
    public static string Read(string path)
    {
        RejectLinks(path);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > SavedVariables.MaxBytes) throw new InvalidOperationException("Файл прогресса превышает 2 МБ.");
        using var reader = new StreamReader(file, new UTF8Encoding(false, true));
        return reader.ReadToEnd();
    }
    public static List<LocalCharacter> Scan(string addonsPath)
    {
        var addons = AddonInstaller.ValidateAddOns(addonsPath);
        var root = Path.Combine(Directory.GetParent(addons)!.Parent!.FullName, "WTF", "Account");
        if (!Directory.Exists(root)) return [];
        RejectLinks(root);
        var result = new List<LocalCharacter>();
        foreach (var account in Directory.EnumerateDirectories(root))
        {
            RejectLinks(account);
            foreach (var realm in Directory.EnumerateDirectories(account))
            {
                RejectLinks(realm);
                if (Path.GetFileName(realm).Equals("SavedVariables", StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var character in Directory.EnumerateDirectories(realm))
                {
                    RejectLinks(character);
                    var path = Path.Combine(character, "SavedVariables", "DiscodicXP.lua");
                    if (!File.Exists(path)) continue;
                    var identity = SavedVariables.TryIdentity(Read(path));
                    if (identity is null) continue;
                    var realmFolder = Path.GetFileName(realm);
                    var characterFolder = Path.GetFileName(character);
                    var sameName = identity.Name.Equals(characterFolder, StringComparison.OrdinalIgnoreCase);
                    var namedRealm = sameName && identity.Realm.Equals(realmFolder, StringComparison.OrdinalIgnoreCase);
                    var numberedRealm = realmFolder.All(char.IsAsciiDigit)
                        && (sameName || (characterFolder.StartsWith(identity.Name + "-", StringComparison.OrdinalIgnoreCase)
                            && characterFolder.Length > identity.Name.Length + 1));
                    if (!namedRealm && !numberedRealm)
                        throw new InvalidOperationException("Имя или сервер персонажа не совпадает с папкой сохранения. Войди персонажем и выйди из WoW.");
                    result.Add(new LocalCharacter(path, Path.GetFileName(account), identity));
                }
            }
        }
        return result.OrderBy(item => item.Identity.Name).ToList();
    }
    public static string Hash(string content) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
    public static string Restore(LocalCharacter local, string content, string expectedHash, Func<bool>? gameRunning = null)
    {
        gameRunning ??= AddonInstaller.GameIsRunning;
        if (gameRunning()) throw new InvalidOperationException("Закрой WoW перед загрузкой прогресса.");
        if (SavedVariables.Identity(content) != local.Identity) throw new InvalidOperationException("Сохранение относится к другому персонажу. Изменения не применены.");
        var current = Read(local.Path);
        if (Hash(current) != expectedHash) throw new InvalidOperationException("Локальный файл изменился во время синхронизации. Повтори поиск персонажей.");
        var backup = local.Path + ".dxp-backup-" + System.Guid.NewGuid().ToString("N");
        var temporary = local.Path + ".dxp-" + System.Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(new UTF8Encoding(false).GetBytes(content));
                stream.Flush(true);
            }
            if (gameRunning()) throw new InvalidOperationException("WoW запущен. Закрой игру и повтори синхронизацию.");
            if (Hash(Read(local.Path)) != expectedHash) throw new InvalidOperationException("Локальный прогресс изменился. Загрузка отменена.");
            File.Replace(temporary, local.Path, backup);
            return backup;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

public sealed class ProgressSync
{
    private readonly string statePath;
    public ProgressSync(string? path = null) => statePath = path ?? Path.Combine(LauncherSettings.DataPath, "sync-state.json");
    private Dictionary<string, SyncState> States() => File.Exists(statePath)
        ? JsonSerializer.Deserialize<Dictionary<string, SyncState>>(File.ReadAllText(statePath)) ?? new() : new();
    private void SaveState(string key, int revision, string content)
    {
        var states = States(); states[key] = new SyncState(revision, ProgressFiles.Hash(content));
        Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
        var temporary = statePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(states));
        File.Move(temporary, statePath, true);
    }
    public async Task<SyncPlan> Plan(ProgressClient client, LocalCharacter local, bool forceDownload, CancellationToken cancellation)
    {
        ProgressFiles.EnsureClosed();
        var content = ProgressFiles.Read(local.Path);
        if (SavedVariables.Identity(content) != local.Identity) throw new InvalidOperationException("Персонаж в локальном файле изменился. Повтори поиск.");
        var account = await client.Account(cancellation);
        var remote = (await client.Characters(cancellation)).SingleOrDefault(item => item.Guid == local.Identity.Guid);
        var key = ProgressFiles.Hash($"{client.Server}|{account.Id}|{Path.GetFullPath(local.Path).ToUpperInvariant()}");
        var state = States().GetValueOrDefault(key);
        if (state is not null && remote is not null && remote.Revision < state.Revision) throw new InvalidOperationException("Сервер вернул более старую ревизию. Проверь восстановление базы сервера.");
        if (forceDownload && remote is null) throw new InvalidOperationException("На сервере ещё нет сохранения этого персонажа.");
        var download = forceDownload || (remote is not null && (state is null || (ProgressFiles.Hash(content) == state.Hash && remote.Revision > state.Revision)));
        if (!download && remote is not null && remote.Revision != (state?.Revision ?? 0))
            throw new InvalidOperationException("Прогресс изменён на обоих компьютерах. Для продолжения загрузи серверную версию: локальная останется в резервной копии.");
        var unchanged = !download && state is not null && remote?.Revision == state.Revision && ProgressFiles.Hash(content) == state.Hash;
        return new SyncPlan(local, remote, account, content, key, state?.Revision ?? 0, download, unchanged);
    }
    public async Task<string> Apply(ProgressClient client, SyncPlan plan, CancellationToken cancellation)
    {
        ProgressFiles.EnsureClosed();
        if (ProgressFiles.Hash(ProgressFiles.Read(plan.Local.Path)) != ProgressFiles.Hash(plan.Content)) throw new InvalidOperationException("Локальный прогресс изменился. Повтори синхронизацию.");
        if (plan.Unchanged) return "Прогресс уже синхронизирован.";
        if (plan.Download)
        {
            var saved = await client.Download(plan.Remote!.Id, cancellation);
            if (saved.SchemaVersion != 1 || saved.Character.Guid != plan.Local.Identity.Guid || saved.Revision < plan.Remote.Revision)
                throw new InvalidOperationException("Сервер вернул некорректное сохранение.");
            var backup = ProgressFiles.Restore(plan.Local, saved.Content, ProgressFiles.Hash(plan.Content));
            SaveState(plan.StateKey, saved.Revision, saved.Content);
            return $"Загружена ревизия {saved.Revision}. Можно запускать WoW. Резервная копия: {backup}";
        }
        var uploaded = await client.Upload(plan, cancellation);
        if (uploaded.Guid != plan.Local.Identity.Guid || uploaded.Revision != plan.BaseRevision + 1) throw new InvalidOperationException("Сервер вернул некорректную ревизию.");
        SaveState(plan.StateKey, uploaded.Revision, plan.Content);
        return $"Прогресс сохранён для {plan.Account.BattleTag}: {plan.Local.Identity.Name}, ревизия {uploaded.Revision}.";
    }
}
