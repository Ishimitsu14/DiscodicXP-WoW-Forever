using System.IO.Compression;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using DiscodicXP.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var testRoot = Path.Combine(Path.GetTempPath(), "DiscodicXP-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testRoot);
        var checks = 0;
        try
        {
            var addons = Path.Combine(testRoot, "WoW", "Interface", "AddOns");
            Directory.CreateDirectory(addons);
            var archive = Path.Combine(testRoot, "addon.zip");
            MakeArchive(archive, "0.3.2");
            var prepared = Path.Combine(testRoot, "prepared");
            AddonInstaller.Extract(archive, prepared, "0.3.2");
            Check(File.Exists(Path.Combine(prepared, "DiscodicXP", "DiscodicXP.toc")), "valid archive extracts");
            Check(AddonInstaller.InstalledVersion(addons) == "не установлен", "new installation detected");
            Check(AddonInstaller.Install(addons, Path.Combine(prepared, "DiscodicXP"), "0.3.2") == "", "first installation succeeds");
            Check(AddonInstaller.InstalledVersion(addons) == "0.3.2", "installed version is readable");
            var savedVariables = Path.Combine(testRoot, "WoW", "WTF", "Account", "SavedVariables.lua");
            Directory.CreateDirectory(Path.GetDirectoryName(savedVariables)!);
            File.WriteAllText(savedVariables, "character progress");
            var backup = AddonInstaller.Install(addons, Path.Combine(prepared, "DiscodicXP"), "0.3.2");
            Check(File.Exists(Path.Combine(backup, "DiscodicXP.toc")), "previous installation is retained");
            Check(File.ReadAllText(savedVariables) == "character progress", "WTF progress is preserved");
            File.WriteAllText(Path.Combine(addons, "DiscodicXP", "obsolete.lua"), "old file");
            AddonInstaller.Install(addons, Path.Combine(prepared, "DiscodicXP"), "0.3.2");
            Check(!File.Exists(Path.Combine(addons, "DiscodicXP", "obsolete.lua")), "obsolete files are removed by replacement");
            Throws(() => AddonInstaller.Extract(archive, Path.Combine(testRoot, "wrong-version"), "0.3.3"), "wrong version rejected");
            foreach (var path in new[] { "DiscodicXP/../escape.lua", "DiscodicXP/C:/escape.lua", "../escape.lua", "DiscodicXP/CON.txt", "DiscodicXP/file. ", "DiscodicXP/file.lua:stream" })
            {
                var invalid = Path.Combine(testRoot, Guid.NewGuid() + ".zip");
                using (var zip = ZipFile.Open(invalid, ZipArchiveMode.Create))
                using (var writer = new StreamWriter(zip.CreateEntry(path).Open())) writer.Write("untrusted");
                Throws(() => AddonInstaller.Extract(invalid, Path.Combine(testRoot, Guid.NewGuid().ToString()), "0.3.2"), "unsafe path rejected");
            }
            Check(!File.Exists(Path.Combine(testRoot, "escape.lua")), "archive cannot escape destination");
            var occupied = Path.Combine(testRoot, "other", "Interface", "AddOns", "DiscodicXP");
            Directory.CreateDirectory(occupied);
            File.WriteAllText(Path.Combine(occupied, "personal.txt"), "keep");
            Throws(() => AddonInstaller.Install(Path.GetDirectoryName(occupied)!, Path.Combine(prepared, "DiscodicXP"), "0.3.2"), "unknown folder is protected");
            Check(File.ReadAllText(Path.Combine(occupied, "personal.txt")) == "keep", "unknown folder survives");
            Throws(() => AddonInstaller.ValidateAddOns(testRoot), "wrong game folder rejected");
            var secret = "dxp_" + new string('x', 43);
            var protectedSecret = DeviceSecret.Protect(secret);
            Check(!protectedSecret.Contains(secret) && DeviceSecret.Unprotect(protectedSecret) == secret, "device key uses Windows encryption");
            if (args.Length > 0)
            {
                AddonInstaller.Extract(Path.GetFullPath(args[0]), Path.Combine(testRoot, "real-release"), "0.3.1");
                Check(File.Exists(Path.Combine(testRoot, "real-release", "DiscodicXP", "DiscodicXP.toc")), "real GitHub package extracts");
            }
            if (args.Length > 1)
            {
                var app = new App();
                app.InitializeComponent();
                var window = new MainWindow();
                ((TextBox)window.FindName("ServerBox")).Text = "https://updates.example.com";
                ((PasswordBox)window.FindName("DeviceKeyBox")).Password = "";
                ((TextBox)window.FindName("AddOnsBox")).Text = @"E:\Games\WoW Forever\Interface\AddOns";
                var content = (UIElement)window.Content;
                window.Content = null;
                var canvas = new Border { Background = window.Background, Child = content, Width = 660, Height = 650 };
                canvas.SetValue(TextElement.ForegroundProperty, window.Foreground);
                canvas.SetValue(TextElement.FontFamilyProperty, window.FontFamily);
                canvas.SetValue(TextElement.FontSizeProperty, window.FontSize);
                canvas.Measure(new Size(660, 650));
                canvas.Arrange(new Rect(0, 0, 660, 650));
                canvas.UpdateLayout();
                var bitmap = new RenderTargetBitmap(660, 650, 96, 96, PixelFormats.Pbgra32);
                bitmap.Render(canvas);
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(bitmap));
                using var image = File.Create(Path.GetFullPath(args[1]));
                encoder.Save(image);
                window.Close();
                app.Shutdown();
                Check(image.Length > 0, "WPF screen renders");
            }
            Console.WriteLine($"Launcher checks passed: {checks}");
        }
        finally
        {
            var expectedParent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
            if (Path.GetDirectoryName(Path.GetFullPath(testRoot)) != expectedParent || !Path.GetFileName(testRoot).StartsWith("DiscodicXP-check-"))
                throw new InvalidOperationException("Unsafe test cleanup path.");
            Directory.Delete(testRoot, true);
        }

        void Check(bool condition, string name)
        {
            if (!condition) throw new Exception("Failed: " + name);
            checks++;
        }

        void Throws(Action action, string name)
        {
            try { action(); }
            catch { checks++; return; }
            throw new Exception("Failed: " + name);
        }

        static void MakeArchive(string path, string version)
        {
            using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
            using (var writer = new StreamWriter(zip.CreateEntry("DiscodicXP/build.json").Open()))
                writer.Write("{\"addon\":\"DiscodicXP\",\"version\":\"" + version + "\",\"interface\":16001}");
            using (var writer = new StreamWriter(zip.CreateEntry("DiscodicXP/DiscodicXP.toc").Open())) writer.Write("## Interface: 16001");
        }
    }
}
