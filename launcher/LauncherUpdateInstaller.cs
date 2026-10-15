using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

internal sealed record LauncherUpdateJob(string Id, LauncherRelease Release, string TargetPath, string PreviousSha256, int ParentId, long ParentStarted);

public sealed class LauncherUpdateInstaller
{
    private readonly string root;
    public LauncherUpdateInstaller() : this(Path.Combine(LauncherSettings.DataPath, "updates")) { }
    internal LauncherUpdateInstaller(string root) => this.root = Path.GetFullPath(root);
    private string Folder(string id)
    {
        if (!Regex.IsMatch(id, "^[a-f0-9]{32}$")) throw new InvalidOperationException("Некорректная папка обновления лаунчера.");
        var path = Path.Combine(root, id);
        RejectLinks(path);
        return path;
    }
    private static void RejectLinks(string path)
    {
        for (var current = Path.GetFullPath(path); current is not null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Путь лаунчера не должен содержать ссылки или junction.");
    }
    internal static string Hash(string path)
    {
        using var file = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant();
    }
    public string CreateJob()
    {
        var id = Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(Folder(id));
        return id;
    }
    public string DownloadPath(string id) => Path.Combine(Folder(id), "DiscodicXP.Launcher.exe");
    private static void ValidateBinary(string path, LauncherRelease release)
    {
        release.Validate();
        RejectLinks(path);
        if (new FileInfo(path).Length != release.Size || Hash(path) != release.Sha256)
            throw new InvalidOperationException("Файл обновления лаунчера повреждён. Текущая версия сохранена.");
        using (var file = File.OpenRead(path))
            if (file.ReadByte() != 'M' || file.ReadByte() != 'Z') throw new InvalidOperationException("Обновление не является Windows-приложением.");
        var info = FileVersionInfo.GetVersionInfo(path);
        var version = info.ProductVersion?.Split('+')[0];
        if (info.ProductName != "DiscodicXP.Launcher" || version != release.Version)
            throw new InvalidOperationException("Версия или приложение в обновлении лаунчера не совпадают с описанием.");
    }
    internal LauncherUpdateJob Prepare(string id, LauncherRelease release, string? targetPath = null)
    {
        var target = Path.GetFullPath(targetPath ?? Environment.ProcessPath ?? throw new InvalidOperationException("Не удалось определить путь лаунчера."));
        RejectLinks(target);
        if (!File.Exists(target) || !Path.GetExtension(target).Equals(".exe", StringComparison.OrdinalIgnoreCase)
            || target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Запусти установленный exe лаунчера перед обновлением.");
        ValidateBinary(DownloadPath(id), release);
        var directory = Path.GetDirectoryName(target)!;
        using (new FileStream(Path.Combine(directory, ".DiscodicXP-write-" + id + ".tmp"), FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
        using var parent = Process.GetCurrentProcess();
        var job = new LauncherUpdateJob(id, release, target, Hash(target), parent.Id, parent.StartTime.ToUniversalTime().Ticks);
        File.WriteAllText(Path.Combine(Folder(id), "update.json"), JsonSerializer.Serialize(job));
        return job;
    }
    private LauncherUpdateJob ReadJob(string id)
    {
        var path = Path.Combine(Folder(id), "update.json");
        RejectLinks(path);
        if (new FileInfo(path).Length > 16384) throw new InvalidOperationException("Некорректное задание обновления лаунчера.");
        var job = JsonSerializer.Deserialize<LauncherUpdateJob>(File.ReadAllText(path))
            ?? throw new InvalidOperationException("Задание обновления лаунчера отсутствует.");
        job.Release.Validate();
        if (job.Id != id || !Regex.IsMatch(job.PreviousSha256 ?? "", "^[a-f0-9]{64}$") || job.ParentId <= 0
            || job.TargetPath != Path.GetFullPath(job.TargetPath) || !job.TargetPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            || job.TargetPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Некорректное задание обновления лаунчера.");
        RejectLinks(job.TargetPath);
        return job;
    }
    private static Process Start(string path, params string[] arguments)
    {
        var start = new ProcessStartInfo(path) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(path)! };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        return Process.Start(start) ?? throw new InvalidOperationException("Не удалось перезапустить лаунчер.");
    }
    internal async Task StartHelper(LauncherUpdateJob job, CancellationToken cancellation)
    {
        using var process = Start(DownloadPath(job.Id), "--apply-launcher-update", job.Id);
        try
        {
            for (var attempt = 0; attempt < 150; attempt++)
            {
                if (File.Exists(Path.Combine(Folder(job.Id), "ready"))) return;
                if (process.HasExited) break;
                await Task.Delay(100, cancellation);
            }
            throw new InvalidOperationException("Не удалось подготовить перезапуск. Текущая версия лаунчера сохранена.");
        }
        catch
        {
            // A helper that was not acknowledged must never replace the still-running launcher later.
            if (!process.HasExited) { process.Kill(); await process.WaitForExitAsync(CancellationToken.None); }
            throw;
        }
    }
    private static string BackupPath(LauncherUpdateJob job) => Path.Combine(Path.GetDirectoryName(job.TargetPath)!, ".DiscodicXP-backup-" + job.Id + ".exe");
    internal async Task Install(LauncherUpdateJob job, Func<Task> restart)
    {
        var stage = Path.Combine(Path.GetDirectoryName(job.TargetPath)!, ".DiscodicXP-update-" + job.Id + ".exe");
        var staged = false;
        RejectLinks(job.TargetPath);
        RejectLinks(BackupPath(job));
        ValidateBinary(DownloadPath(job.Id), job.Release);
        try
        {
            using (var source = File.OpenRead(DownloadPath(job.Id)))
            using (var destination = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { staged = true; source.CopyTo(destination); destination.Flush(true); }
            if (Hash(stage) != job.Release.Sha256 || Hash(job.TargetPath) != job.PreviousSha256 || File.Exists(BackupPath(job)))
                throw new InvalidOperationException("Лаунчер изменился во время обновления. Замена отменена.");
            File.Replace(stage, job.TargetPath, BackupPath(job));
            try { await restart(); }
            catch
            {
                if (Hash(job.TargetPath) == job.Release.Sha256 && Hash(BackupPath(job)) == job.PreviousSha256)
                    File.Replace(BackupPath(job), job.TargetPath, null);
                throw;
            }
        }
        finally { if (staged && File.Exists(stage)) File.Delete(stage); }
    }
    internal async Task<bool> RunHelper(string id)
    {
        LauncherUpdateJob? job = null;
        var parentClosed = false;
        try
        {
            job = ReadJob(id);
            if (!string.Equals(Environment.ProcessPath, DownloadPath(id), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Обновление запущено из другой папки.");
            ValidateBinary(DownloadPath(id), job.Release);
            using (var parent = Process.GetProcessById(job.ParentId))
            {
                if (parent.StartTime.ToUniversalTime().Ticks != job.ParentStarted
                    || !string.Equals(parent.MainModule?.FileName, job.TargetPath, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Процесс лаунчера изменился. Обновление отменено.");
                File.WriteAllText(Path.Combine(Folder(id), "ready"), "ready");
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                await parent.WaitForExitAsync(timeout.Token);
            }
            parentClosed = true;
            await Install(job, async () =>
            {
                using var restarted = Start(job.TargetPath, "--launcher-update-complete", id);
                try
                {
                    for (var attempt = 0; attempt < 300; attempt++)
                    {
                        if (File.Exists(Path.Combine(Folder(id), "complete"))) return;
                        if (restarted.HasExited) break;
                        await Task.Delay(100);
                    }
                    throw new InvalidOperationException("Новая версия не запустилась. Восстановлена предыдущая версия лаунчера.");
                }
                catch
                {
                    if (!restarted.HasExited) { restarted.Kill(); await restarted.WaitForExitAsync(); }
                    throw;
                }
            });
            return true;
        }
        catch
        {
            if (parentClosed && job is not null)
            {
                try { using var previous = Start(job.TargetPath); }
                catch { }
                System.Windows.MessageBox.Show("Обновление не завершилось. Предыдущая версия сохранена; повтори обновление позже.", "Обновление DiscodicXP");
            }
            return false;
        }
    }
    internal void Complete(string id)
    {
        var job = ReadJob(id);
        if (!string.Equals(job.TargetPath, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Путь обновлённого лаунчера не совпадает с заданием.");
        ValidateBinary(job.TargetPath, job.Release);
        File.WriteAllText(Path.Combine(Folder(id), "complete"), "complete");
        _ = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 15; attempt++)
            {
                await Task.Delay(1000);
                try
                {
                    var backup = BackupPath(job);
                    if (File.Exists(backup) && Hash(backup) == job.PreviousSha256) File.Delete(backup);
                    DeleteJob(id);
                    return;
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        });
    }
    public void DeleteJob(string id)
    {
        var folder = Folder(id);
        foreach (var name in new[] { "DiscodicXP.Launcher.exe", "update.json", "ready", "complete" })
        {
            var path = Path.Combine(folder, name);
            RejectLinks(path);
            if (File.Exists(path)) File.Delete(path);
        }
        if (Directory.Exists(folder)) Directory.Delete(folder);
    }
}
