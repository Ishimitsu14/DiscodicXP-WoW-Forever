using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

public static class AddonInstaller
{
    public static string ValidateAddOns(string path)
    {
        var fullPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path.Trim()));
        if (!Directory.Exists(fullPath) || !Path.GetFileName(fullPath).Equals("AddOns", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(Path.GetFileName(Path.GetDirectoryName(fullPath)), "Interface", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Выбери существующую папку Interface\\AddOns своего клиента WoW.");
        RejectLinks(fullPath);
        return fullPath;
    }

    private static void RejectLinks(string path)
    {
        for (DirectoryInfo? directory = new(path); directory is not null; directory = directory.Parent)
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Папка установки не должна содержать ссылки или junction. Выбери прямой путь к клиенту.");
    }

    private static JsonDocument ReadManifest(string path)
    {
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(path, "build.json")));
        if (manifest.RootElement.GetProperty("addon").GetString() != "DiscodicXP"
            || !File.Exists(Path.Combine(path, "DiscodicXP.toc")))
        {
            manifest.Dispose();
            throw new InvalidOperationException("В папке отсутствует корректная сборка DiscodicXP.");
        }
        return manifest;
    }

    public static string InstalledVersion(string addonsPath)
    {
        var target = Path.Combine(ValidateAddOns(addonsPath), "DiscodicXP");
        if (!Directory.Exists(target)) return "не установлен";
        RejectLinks(target);
        using var manifest = ReadManifest(target);
        return manifest.RootElement.GetProperty("version").GetString() ?? "неизвестна";
    }

    public static bool GameIsRunning()
    {
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try { if (process.ProcessName.StartsWith("WoW", StringComparison.OrdinalIgnoreCase)) return true; }
                catch (InvalidOperationException) { }
            }
        }
        return false;
    }

    public static void Extract(string archivePath, string destination, string expectedVersion)
    {
        using var archive = ZipFile.OpenRead(archivePath);
        if (archive.Entries.Count is 0 or > 20_000) throw new InvalidOperationException("Некорректное число файлов в архиве.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long expandedSize = 0;
        foreach (var entry in archive.Entries)
        {
            var name = entry.FullName.Replace('\\', '/');
            var parts = name.TrimEnd('/').Split('/');
            if (!name.StartsWith("DiscodicXP/", StringComparison.Ordinal) || parts.Any(part => part.Length == 0
                || part is "." or ".." || part.Contains(':') || part.EndsWith(' ') || part.EndsWith('.')
                || Regex.IsMatch(part, @"[<>""|?*\x00-\x1f]")
                || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", RegexOptions.IgnoreCase))
                || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000
                || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0 || !seen.Add(name.TrimEnd('/')))
                throw new InvalidOperationException("Архив содержит небезопасный путь или повторяющийся файл.");
            expandedSize += entry.Length;
            if (expandedSize > 256 * 1024 * 1024 || entry.Length > 64 * 1024 * 1024)
                throw new InvalidOperationException("Распакованный архив превышает допустимый размер.");
        }
        Directory.CreateDirectory(destination);
        ZipFile.ExtractToDirectory(archivePath, destination);
        using var manifest = ReadManifest(Path.Combine(destination, "DiscodicXP"));
        if (manifest.RootElement.GetProperty("version").GetString() != expectedVersion
            || manifest.RootElement.GetProperty("interface").GetInt32() != 16001)
            throw new InvalidOperationException("Версия или клиент в архиве не совпадают с обновлением.");
    }

    public static string Install(string addonsPath, string preparedAddon, string expectedVersion)
    {
        var root = ValidateAddOns(addonsPath);
        using (var manifest = ReadManifest(preparedAddon))
            if (manifest.RootElement.GetProperty("version").GetString() != expectedVersion)
                throw new InvalidOperationException("Подготовлена другая версия аддона.");
        if (GameIsRunning()) throw new InvalidOperationException("Закрой WoW перед установкой обновления.");
        var target = Path.Combine(root, "DiscodicXP");
        var stamp = Guid.NewGuid().ToString("N");
        var staging = Path.Combine(root, ".DiscodicXP-stage-" + stamp);
        var backup = Path.Combine(root, ".DiscodicXP-backup-" + stamp);
        if (Directory.Exists(target))
        {
            RejectLinks(target);
            using var existing = ReadManifest(target);
        }
        Directory.CreateDirectory(staging);
        try
        {
            CopyDirectory(preparedAddon, staging);
            if (GameIsRunning()) throw new InvalidOperationException("WoW запущен. Закрой игру и повтори установку.");
            if (Directory.Exists(target)) Directory.Move(target, backup);
            try { Directory.Move(staging, target); }
            catch
            {
                if (Directory.Exists(backup) && !Directory.Exists(target)) Directory.Move(backup, target);
                throw;
            }
            return Directory.Exists(backup) ? backup : "";
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                if (!string.Equals(Path.GetDirectoryName(Path.GetFullPath(staging)), root, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Некорректная папка временной установки.");
                RejectLinks(staging);
                Directory.Delete(staging, true);
            }
        }
    }

    private static void CopyDirectory(string source, string target)
    {
        foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
        foreach (var directory in Directory.EnumerateDirectories(source))
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("В пакете найдена ссылка на другую папку.");
            var next = Path.Combine(target, Path.GetFileName(directory));
            Directory.CreateDirectory(next);
            CopyDirectory(directory, next);
        }
    }
}
