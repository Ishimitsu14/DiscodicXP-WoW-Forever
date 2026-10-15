using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;

namespace DiscodicXP.Launcher;

public partial class MainWindow : Window
{
    private bool busy;
    private bool checkingLauncher;
    private readonly CancellationTokenSource cancellation = new();
    private readonly DispatcherTimer gameWatcher = new() { Interval = TimeSpan.FromSeconds(5) };
    private readonly GameSessionWatcher gameSession;
    private string selectedCharacterPath = "";
    internal bool SaveOnClose { get; set; } = true;

    public MainWindow()
    {
        InitializeComponent();
        LauncherVersionLabel.Text = "Лаунчер " + LauncherVersion.Current;
        ServerBox.Text = LauncherSettings.DefaultServer;
        try
        {
            var settings = LauncherSettings.Load();
            ServerBox.Text = settings.Server;
            AddOnsBox.Text = settings.AddOnsPath;
            DeviceKeyBox.Password = DeviceSecret.Unprotect(settings.ProtectedKey);
            AutoSyncBox.IsChecked = settings.AutoSync;
            selectedCharacterPath = settings.CharacterPath;
            if (settings.AddOnsPath.Length > 0)
            {
                ShowInstalled();
                FindCharacters();
            }
        }
        catch { StatusLabel.Text = "Не удалось прочитать сохранённые настройки. Укажи подключение заново."; }
        Closing += OnClosing;
        gameSession = new GameSessionWatcher(AddonInstaller.GameIsRunning());
        gameWatcher.Tick += WatchGame;
        gameWatcher.Start();
        Loaded += async (_, _) => await CheckLauncherUpdate();
    }

    internal void ShowLauncherUpdateError(string message) => LauncherUpdateLabel.Text = message;

    private async void LauncherCheck_Click(object sender, RoutedEventArgs args) => await CheckLauncherUpdate();

    private async Task CheckLauncherUpdate()
    {
        if (busy || checkingLauncher) return;
        checkingLauncher = true;
        LauncherCheckButton.IsEnabled = false;
        LauncherUpdateButton.IsEnabled = false;
        LauncherUpdateLabel.Text = "Проверяю обновления лаунчера…";
        try
        {
            using var client = new LauncherUpdateClient();
            var launcherRelease = await client.Latest(cancellation.Token);
            LauncherUpdateLabel.Text = launcherRelease.IsNewer ? $"Доступна версия {launcherRelease.Version}. Настройки сохранятся после перезапуска."
                : "Установлена актуальная версия лаунчера.";
            LauncherUpdateButton.Visibility = launcherRelease.IsNewer ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception)
        {
            if (!cancellation.IsCancellationRequested) LauncherUpdateLabel.Text = "Не удалось проверить обновление лаунчера. Можно повторить позже.";
        }
        finally { checkingLauncher = false; LauncherCheckButton.IsEnabled = !busy; LauncherUpdateButton.IsEnabled = !busy; }
    }

    private async void LauncherUpdate_Click(object sender, RoutedEventArgs args)
    {
        if (busy || checkingLauncher) return;
        SetBusy(true);
        var installer = new LauncherUpdateInstaller();
        string? jobId = null;
        var restarting = false;
        try
        {
            using var client = new LauncherUpdateClient();
            var release = await client.Latest(cancellation.Token);
            if (!release.IsNewer)
            {
                LauncherUpdateLabel.Text = "Установлена актуальная версия лаунчера.";
                LauncherUpdateButton.Visibility = Visibility.Collapsed;
                return;
            }
            SaveSettings(AddOnsBox.Text.Trim(), DeviceKeyBox.Password.Trim());
            jobId = installer.CreateJob();
            Progress.IsIndeterminate = false;
            LauncherUpdateLabel.Text = $"Скачиваю лаунчер {release.Version}…";
            await client.Download(release, installer.DownloadPath(jobId), new Progress<int>(value =>
            {
                Progress.Value = value;
                LauncherUpdateLabel.Text = $"Скачиваю лаунчер {release.Version}: {value}%";
            }), cancellation.Token);
            Progress.IsIndeterminate = true;
            LauncherUpdateLabel.Text = "Проверяю файл и готовлю перезапуск…";
            var job = await Task.Run(() => installer.Prepare(jobId, release));
            await installer.StartHelper(job, cancellation.Token);
            restarting = true;
            busy = false;
            Close();
        }
        catch (Exception error)
        {
            ShowError(error);
            LauncherUpdateLabel.Text = "Обновление не завершено. Текущая версия лаунчера сохранена.";
        }
        finally
        {
            if (!restarting && jobId is not null)
            {
                try { installer.DeleteJob(jobId); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            SetBusy(false);
        }
    }

    private void OnClosing(object? sender, CancelEventArgs args)
    {
        if (busy)
        {
            args.Cancel = true;
            StatusLabel.Text = "Дождись завершения операции перед закрытием окна.";
        }
        else
        {
            gameWatcher.Stop();
            cancellation.Cancel();
            try { if (SaveOnClose) SaveSettings(AddOnsBox.Text, DeviceKeyBox.Password.Trim()); }
            catch { }
        }
    }

    private void ShowInstalled() => InstalledLabel.Text = "Установленная версия: " + AddonInstaller.InstalledVersion(AddOnsBox.Text);

    private void Browse_Click(object sender, RoutedEventArgs args)
    {
        var dialog = new OpenFolderDialog { Title = "Выбери папку Interface\\AddOns клиента Forever" };
        if (dialog.ShowDialog(this) != true) return;
        AddOnsBox.Text = dialog.FolderName;
        try { ShowInstalled(); FindCharacters(); }
        catch (Exception error) { ShowError(error); }
    }

    private async void Check_Click(object sender, RoutedEventArgs args) => await Run(false);
    private async void Update_Click(object sender, RoutedEventArgs args) => await Run(true);

    private async void GuideUpdate_Click(object sender, RoutedEventArgs args)
    {
        if (busy) return;
        SetBusy(true);
        try
        {
            var path = AddonInstaller.ValidateAddOns(AddOnsBox.Text);
            GuideFiles.ValidateInstallation(path);
            var key = DeviceKeyBox.Password.Trim();
            using var client = new GuideClient(ServerBox.Text, key);
            SaveSettings(path, key);
            StatusLabel.Text = "Проверяю опубликованные гайды…";
            var release = await client.Latest(cancellation.Token);
            StatusLabel.Text = $"Скачиваю гайды: ревизия {release.Revision}…";
            var bytes = await client.Download(release, cancellation.Token);
            var updated = await Task.Run(() => GuideFiles.Install(path, release, bytes));
            GuideLabel.Text = $"Гайды: ревизия {release.Revision} · разделов {release.SectionCount}";
            StatusLabel.Text = updated ? "Гайды обновлены. Выполни /reload в игре или запусти WoW. Прогресс сохранён."
                : "Эта версия гайдов уже установлена. Если WoW открыт, выполни /reload для применения.";
        }
        catch (Exception error) { ShowError(error); }
        finally { SetBusy(false); }
    }

    private void Scan_Click(object sender, RoutedEventArgs args)
    {
        try
        {
            var characters = FindCharacters();
            StatusLabel.Text = characters.Count > 0 ? $"Найдено персонажей: {characters.Count}. Закрой WoW перед синхронизацией."
                : "Нет сохранений. Установи обновлённый аддон, войди персонажем и нормально выйди из WoW.";
        }
        catch (Exception error) { ShowError(error); }
    }

    private List<LocalCharacter> FindCharacters()
    {
        if (CharacterBox.SelectedItem is LocalCharacter selected) selectedCharacterPath = selected.Path;
        var characters = ProgressFiles.Scan(AddOnsBox.Text);
        CharacterBox.ItemsSource = characters;
        CharacterBox.SelectedItem = characters.FirstOrDefault(item => item.Path == selectedCharacterPath) ?? characters.FirstOrDefault();
        return characters;
    }

    private void SaveSettings(string path, string key)
    {
        selectedCharacterPath = (CharacterBox.SelectedItem as LocalCharacter)?.Path ?? "";
        new LauncherSettings(ServerBox.Text.Trim(), path, DeviceSecret.Protect(key), AutoSyncBox.IsChecked == true, selectedCharacterPath).Save();
    }

    private async void WatchGame(object? sender, EventArgs args)
    {
        if (!gameSession.ShouldSave(AddonInstaller.GameIsRunning(), AutoSyncBox.IsChecked == true, busy)) return;
        if (CharacterBox.SelectedItem is LocalCharacter) await Sync(false, true);
    }

    private async void Sync_Click(object sender, RoutedEventArgs args) => await Sync(false);
    private async void Restore_Click(object sender, RoutedEventArgs args) => await Sync(true);

    private async Task Sync(bool download, bool automatic = false)
    {
        if (busy) return;
        if (CharacterBox.SelectedItem is not LocalCharacter character)
        {
            StatusLabel.Text = "Нажми «Найти» и выбери персонажа.";
            return;
        }
        SetBusy(true);
        try
        {
            ProgressFiles.EnsureClosed();
            var path = AddonInstaller.ValidateAddOns(AddOnsBox.Text);
            if (!ProgressFiles.Scan(path).Any(item => item.Path == character.Path && item.Identity == character.Identity))
                throw new InvalidOperationException("Выбранный персонаж не относится к текущей папке WoW. Повтори поиск.");
            var key = DeviceKeyBox.Password.Trim();
            using var client = new ProgressClient(ServerBox.Text, key);
            SaveSettings(path, key);
            StatusLabel.Text = "Проверяю сохранение на сервере…";
            var sync = new ProgressSync();
            var plan = await sync.Plan(client, character, download, cancellation.Token);
            if (automatic && plan.Download)
            {
                StatusLabel.Text = "Автосохранение остановлено: на сервере есть прогресс. Нажми «Синхронизировать», чтобы выбрать загрузку.";
                return;
            }
            if (plan.Download && MessageBox.Show(this,
                $"Загрузить прогресс {character.Identity.Name} ({character.Identity.Realm}) из аккаунта {plan.Account.BattleTag}?\n\nЛокальная версия останется в резервной копии рядом с файлом прогресса.",
                "Загрузка прогресса", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            {
                StatusLabel.Text = "Загрузка отменена. Локальные данные сохранены.";
                return;
            }
            StatusLabel.Text = plan.Download ? "Загружаю прогресс…" : "Сохраняю прогресс на сервере…";
            StatusLabel.Text = await sync.Apply(client, plan, cancellation.Token);
        }
        catch (Exception error) { ShowError(error); }
        finally { SetBusy(false); }
    }

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
            SaveSettings(path, key);
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
        foreach (var control in new System.Windows.Controls.Control[] { ServerBox, DeviceKeyBox, AddOnsBox, BrowseButton, CheckButton, UpdateButton, GuideUpdateButton, CharacterBox, ScanButton, SyncButton, RestoreButton, AutoSyncBox, LauncherCheckButton, LauncherUpdateButton })
            control.IsEnabled = !value;
        LauncherCheckButton.IsEnabled = !value && !checkingLauncher;
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
