using System.Windows;

namespace DiscodicXP.Launcher;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs args)
    {
        base.OnStartup(args);
        if (args.Args is ["--apply-launcher-update", var jobId])
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            Shutdown(await new LauncherUpdateInstaller().RunHelper(jobId) ? 0 : 1);
            return;
        }
        var window = new MainWindow();
        MainWindow = window;
        window.Show();
        if (args.Args is ["--launcher-update-complete", var completedId])
        {
            try { new LauncherUpdateInstaller().Complete(completedId); }
            catch { window.ShowLauncherUpdateError("Не удалось подтвердить обновление лаунчера."); }
        }
    }
}
