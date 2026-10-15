using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Windows;
using Microsoft.Win32;

namespace DiscodicXP.Launcher;

public partial class MainWindow : Window
{
    private bool busy;
    private readonly CancellationTokenSource cancellation = new();

    public MainWindow()
    {
        InitializeComponent();
        try
        {
            var settings = LauncherSettings.Load();
            ServerBox.Text = settings.Server;
            AddOnsBox.Text = settings.AddOnsPath;
            DeviceKeyBox.Password = DeviceSecret.Unprotect(settings.ProtectedKey);
            if (settings.AddOnsPath.Length > 0) ShowInstalled();
        }
        catch { StatusLabel.Text = "Не удалось прочитать сохранённые настройки. Укажи подключение заново."; }
        Closing += OnClosing;
    }

    private void OnClosing(object? sender, CancelEventArgs args)
    {
        if (busy)
        {
            args.Cancel = true;
            StatusLabel.Text = "Дождись завершения операции перед закрытием окна.";
        }
        else cancellation.Cancel();
    }

    private void ShowInstalled() => InstalledLabel.Text = "Установленная версия: " + AddonInstaller.InstalledVersion(AddOnsBox.Text);

    private void Browse_Click(object sender, RoutedEventArgs args)
    {
        var dialog = new OpenFolderDialog { Title = "Выбери папку Interface\\AddOns клиента Forever" };
        if (dialog.ShowDialog(this) != true) return;
        AddOnsBox.Text = dialog.FolderName;
        try { ShowInstalled(); }
        catch (Exception error) { ShowError(error); }
    }

    private async void Check_Click(object sender, RoutedEventArgs args) => await Run(false);
    private async void Update_Click(object sender, RoutedEventArgs args) => await Run(true);

    private async Task Run(bool install)
    {
        if (busy) return;
        SetBusy(true);
        string? temporary = null;
        try
        {
            var path = AddonInstaller.ValidateAddOns(AddOnsBox.Text);
            var key = DeviceKeyBox.Password.Trim();
            using var client = new UpdateClient(ServerBox.Text, key);
            new LauncherSettings(ServerBox.Text.Trim(), path, DeviceSecret.Protect(key)).Save();
            ShowInstalled();
            StatusLabel.Text = "Проверяю доступную версию…";
            var info = await client.Latest(cancellation.Token);
            AvailableLabel.Text = "Доступная версия: " + info.Version;
            var installed = AddonInstaller.InstalledVersion(path);
            if (Version.TryParse(installed, out var localVersion) && localVersion >= Version.Parse(info.Version))
            {
                StatusLabel.Text = "У тебя уже установлена актуальная версия.";
                return;
            }
            if (!install)
            {
                StatusLabel.Text = "Обновление доступно. Закрой WoW и нажми «Обновить аддон».";
                return;
            }
            if (AddonInstaller.GameIsRunning()) throw new InvalidOperationException("Закрой WoW перед установкой обновления.");
            temporary = Path.Combine(Path.GetTempPath(), "DiscodicXP-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            var archive = Path.Combine(temporary, "addon.zip");
            var extracted = Path.Combine(temporary, "extracted");
            Progress.IsIndeterminate = false;
            StatusLabel.Text = "Скачиваю обновление…";
            await client.Download(info, archive, new Progress<int>(value => Progress.Value = value), cancellation.Token);
            StatusLabel.Text = "Проверяю и устанавливаю файлы…";
            Progress.IsIndeterminate = true;
            var backup = await Task.Run(() =>
            {
                AddonInstaller.Extract(archive, extracted, info.Version);
                return AddonInstaller.Install(path, Path.Combine(extracted, "DiscodicXP"), info.Version);
            });
            ShowInstalled();
            StatusLabel.Text = backup.Length == 0 ? "Готово. Можно запускать WoW." : $"Готово. Можно запускать WoW. Предыдущая версия: {backup}";
        }
        catch (Exception error) { ShowError(error); }
        finally
        {
            if (temporary is not null)
            {
                try
                {
                    var tempRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
                    if (string.Equals(Path.GetDirectoryName(Path.GetFullPath(temporary)), tempRoot, StringComparison.OrdinalIgnoreCase)
                        && Path.GetFileName(temporary).StartsWith("DiscodicXP-", StringComparison.Ordinal)
                        && (File.GetAttributes(temporary) & FileAttributes.ReparsePoint) == 0)
                        Directory.Delete(temporary, true);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            SetBusy(false);
        }
    }

    private void SetBusy(bool value)
    {
        busy = value;
        foreach (var control in new System.Windows.Controls.Control[] { ServerBox, DeviceKeyBox, AddOnsBox, BrowseButton, CheckButton, UpdateButton })
            control.IsEnabled = !value;
        Progress.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        Progress.IsIndeterminate = value;
        Progress.Value = 0;
    }

    private void ShowError(Exception error) => StatusLabel.Text = error switch
    {
        HttpRequestException => "Сервер недоступен. Проверь интернет и адрес сервера.",
        TaskCanceledException => "Сервер не ответил вовремя. Повтори попытку.",
        UnauthorizedAccessException => "Нет прав на запись в выбранную папку. Проверь права доступа.",
        CryptographicException or Win32Exception => "Не удалось сохранить ключ для этого пользователя Windows.",
        InvalidOperationException => error.Message,
        _ => "Не удалось завершить операцию. Проверь папку аддона, свободное место и повтори попытку."
    };
}
