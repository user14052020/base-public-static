using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using System.Windows.Input;
using Microsoft.Win32;

namespace OffersBase.Desktop;

public partial class MainWindow : Window
{
    private readonly BackendClient backend = new();
    private JsonElement? preview;
    private bool busy;
    private readonly DesktopSettingsStore settingsStore = new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OffersBase", "settings.json"));
    private readonly DispatcherTimer settingsSaveTimer = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private bool loadingSettings = true;
    public ObservableCollection<PaymentRow> Rows { get; } = [];

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;
        RepoPath.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OffersBase", "base-public-static");
        try
        {
            var settings = settingsStore.Load();
            if (!string.IsNullOrWhiteSpace(settings.RepoPath)) RepoPath.Text = settings.RepoPath;
            RepositoryUrl.Text = settings.RepositoryUrl;
            AuthorName.Text = settings.AuthorName;
            AuthorEmail.Text = settings.AuthorEmail;
            GithubLogin.Text = settings.GithubLogin;
        }
        catch { /* Invalid optional settings do not prevent startup. */ }
        loadingSettings = false;
        settingsSaveTimer.Tick += (_, _) =>
        {
            settingsSaveTimer.Stop();
            try { SaveSettings(); }
            catch (Exception error) { Status.Text = "Не удалось сохранить настройки: " + error.Message; }
        };
        Loaded += async (_, _) => await LoadGitIdentityAsync();
    }

    private void SaveSettings()
    {
        settingsStore.Save(new DesktopSettings { RepoPath = RepoPath.Text.Trim(), RepositoryUrl = RepositoryUrl.Text.Trim(),
            AuthorName = AuthorName.Text.Trim(), AuthorEmail = AuthorEmail.Text.Trim(), GithubLogin = GithubLogin.Text.Trim() });
    }
    private void SettingsChanged(object sender, TextChangedEventArgs e)
    {
        if (loadingSettings) return;
        settingsSaveTimer.Stop();
        settingsSaveTimer.Start();
    }
    private async Task LoadGitIdentityAsync()
    {
        try
        {
            var result = await backend.ExecuteAsync(new { command = "git-settings", repoDir = RepoPath.Text });
            if (string.IsNullOrWhiteSpace(AuthorName.Text)) AuthorName.Text = result.GetProperty("authorName").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(AuthorEmail.Text)) AuthorEmail.Text = result.GetProperty("authorEmail").GetString() ?? "";
        }
        catch (Exception error) { Status.Text = error.Message; }
    }
    private async void RepositoryChanged(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (!loadingSettings && !busy) await LoadGitIdentityAsync();
    }
    private async void LoginGithub(object sender, RoutedEventArgs e) => await RunAsync("Ожидается вход в GitHub через браузер...", async () =>
    {
        SaveSettings();
        var result = await backend.ExecuteAsync(new { command = "git-login", repositoryUrl = RepositoryUrl.Text, githubLogin = GithubLogin.Text });
        Status.Text = result.GetProperty("message").GetString()!;
    });

    private async Task RunAsync(string message, Func<Task> action)
    {
        if (busy) return;
        busy = true; Sources.IsEnabled = false; Tabs.IsEnabled = false;
        Progress.Visibility = Visibility.Visible; Status.Text = message;
        try { await action(); }
        catch (Exception error)
        {
            Status.Text = "Ошибка";
            MessageBox.Show(this, error.Message, "Offers Base", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { busy = false; Sources.IsEnabled = true; Tabs.IsEnabled = true; Progress.Visibility = Visibility.Collapsed; }
    }

    private void InvalidatePreview()
    {
        preview = null;
        Rows.Clear();
        MatchSummary.Text = "";
    }

    private async void ChooseBackup(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Бекапы (*.json.gz;*.json)|*.json.gz;*.json", Title = "Выберите бекап" };
        if (dialog.ShowDialog(this) != true) return;
        await RunAsync("Проверка бекапа...", async () =>
        {
            var info = await backend.ExecuteAsync(new { command = "inspect", backupPath = dialog.FileName });
            BackupPath.Text = dialog.FileName;
            InvalidatePreview();
            var organizations = info.GetProperty("organizations").EnumerateArray().Select(item => new OrganizationOption(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!)).ToList();
            Organization.ItemsSource = organizations;
            Organization.SelectedIndex = organizations.Count == 1 ? 0 : -1;
            Status.Text = $"Работ: {info.GetProperty("works")}, клиентов: {info.GetProperty("clients")}";
        });
    }

    private void OrganizationChanged(object sender, SelectionChangedEventArgs e)
    {
        if (IsInitialized) InvalidatePreview();
    }

    private void ChooseBank(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Excel (*.xlsx;*.xls)|*.xlsx;*.xls", Title = "Выгрузка операций из банка" };
        if (dialog.ShowDialog(this) != true) return;
        BankPath.Text = dialog.FileName;
        InvalidatePreview();
    }

    private void ChooseRepository(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Папка репозитория base-public-static" };
        if (dialog.ShowDialog(this) == true) RepoPath.Text = dialog.FolderName;
    }

    private async void MatchPayments(object sender, RoutedEventArgs e) => await RunAsync("Сопоставление платежей...", async () =>
    {
        if (Organization.SelectedItem is not OrganizationOption organization) throw new InvalidOperationException("Выберите организацию.");
        var result = await backend.ExecuteAsync(new { command = "preview", backupPath = BackupPath.Text, bankPath = BankPath.Text, organizationId = organization.Id });
        preview = result;
        var invoices = new ObservableCollection<InvoiceOption> { new("", "Не привязан") };
        foreach (var item in result.GetProperty("invoices").EnumerateArray()) invoices.Add(new(item.GetProperty("id").GetString()!, item.GetProperty("label").GetString()!));
        Rows.Clear();
        foreach (var item in result.GetProperty("rows").EnumerateArray())
        {
            var row = new PaymentRow { PaymentId = item.GetProperty("paymentId").GetString()!, Date = item.GetProperty("date").GetString() ?? "",
                OriginalAmount = item.GetProperty("amount").GetDecimal(), Payer = item.GetProperty("payer").GetString()!,
                Purpose = item.GetProperty("purpose").GetString()!, Reason = item.GetProperty("reason").GetString()!,
                CanSelect = item.GetProperty("canSelect").GetBoolean(), Invoices = invoices };
            row.Initialize(item.GetProperty("workId").GetString()!, item.GetProperty("include").GetBoolean(), item.GetProperty("allocationAmount").GetDecimal());
            row.PropertyChanged += (_, _) => UpdateSelectionSummary();
            Rows.Add(row);
        }
        UpdateSelectionSummary();
        Status.Text = $"Всего строк: {result.GetProperty("totalRows")}, входящих: {result.GetProperty("incomingRows")}, найдено счетов: {result.GetProperty("matchedRows")}";
    });

    private void UpdateSelectionSummary()
    {
        var selected = Rows.Where(row => row.Included).ToList();
        decimal amount = 0;
        foreach (var row in selected) { try { amount += row.ParseAmount(); } catch { } }
        MatchSummary.Text = $"Выбрано: {selected.Count} · Распределено: {amount.ToString("N2", CultureInfo.GetCultureInfo("ru-RU"))} ₽";
    }

    private void SplitPayment(object sender, RoutedEventArgs e)
    {
        if (PaymentsGrid.SelectedItem is not PaymentRow original || !original.CanSelect) return;
        var row = original.Split();
        row.PropertyChanged += (_, _) => UpdateSelectionSummary();
        Rows.Insert(Rows.IndexOf(original) + 1, row);
        PaymentsGrid.SelectedItem = row;
    }

    private async Task<string?> SaveUpdatedBackupAsync()
    {
        PaymentsGrid.CommitEdit(DataGridEditingUnit.Cell, true);
        PaymentsGrid.CommitEdit(DataGridEditingUnit.Row, true);
        if (preview is not JsonElement snapshot) throw new InvalidOperationException("Сначала сопоставьте платежи.");
        var selected = Rows.Where(row => row.Included).ToList();
        if (selected.Count == 0) throw new InvalidOperationException("Выберите платежи для привязки.");
        var allocations = selected.Select(row => new { paymentId = row.PaymentId, workId = row.InvoiceId, amount = row.ParseAmount() }).ToList();
        if (allocations.Any(item => string.IsNullOrWhiteSpace(item.workId))) throw new InvalidOperationException("Выберите счет для каждого отмеченного платежа.");
        var dialog = new SaveFileDialog { Filter = "Сжатый бекап (*.json.gz)|*.json.gz", FileName = $"offers-base-payments-{DateTime.Now:yyyyMMdd-HHmmss}.json.gz", DefaultExt = ".json.gz" };
        if (dialog.ShowDialog(this) != true) return null;
        if (MessageBox.Show(this, $"Распределений: {allocations.Count}. Сумма: {allocations.Sum(item => item.amount):N2} ₽.\nРучные суммы оплаты затронутых счетов будут заменены суммой связанных банковских платежей.\nСохранить новый бекап?", "Подтверждение", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return null;
        var result = await backend.ExecuteAsync(new { command = "apply", backupPath = BackupPath.Text, bankPath = BankPath.Text,
            organizationId = snapshot.GetProperty("organizationId").GetString(), backupHash = snapshot.GetProperty("backupHash").GetString(),
            bankHash = snapshot.GetProperty("bankHash").GetString(), allocations, outputPath = dialog.FileName });
        Status.Text = $"Сохранено. Обновлено работ: {result.GetProperty("updatedWorks")}";
        BackupPath.Text = dialog.FileName;
        InvalidatePreview();
        return dialog.FileName;
    }

    private async Task PublishAsync(string backupPath)
    {
        if (string.IsNullOrWhiteSpace(backupPath) || string.IsNullOrWhiteSpace(RepoPath.Text) || Password.Password.Length == 0)
            throw new InvalidOperationException("Выберите бекап, папку репозитория и введите пароль сайта на вкладке Публикация.");
        if (string.IsNullOrWhiteSpace(AuthorName.Text) || string.IsNullOrWhiteSpace(AuthorEmail.Text))
            throw new InvalidOperationException("Заполните имя и email автора на вкладке Публикация.");
        SaveSettings();
        var result = await backend.ExecuteAsync(new { command = "publish", backupPath, repoDir = RepoPath.Text, password = Password.Password,
            repositoryUrl = RepositoryUrl.Text, githubLogin = GithubLogin.Text, authorName = AuthorName.Text, authorEmail = AuthorEmail.Text });
        PublishLog.Text = string.Join(Environment.NewLine, result.GetProperty("messages").EnumerateArray().Select(item => item.GetString()));
        Status.Text = result.GetProperty("changed").GetBoolean() ? "Отправлено в GitHub. Ожидается публикация Pages." : "Этот бекап уже опубликован.";
        Password.Clear();
    }

    private async void PublishBackup(object sender, RoutedEventArgs e) => await RunAsync("Публикация бекапа...", async () =>
    {
        if (MessageBox.Show(this, "Обновить опубликованную стартовую базу из выбранного бекапа?", "Публикация", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            await PublishAsync(BackupPath.Text);
    });
    private async void SavePayments(object sender, RoutedEventArgs e) => await RunAsync("Сохранение бекапа...", async () => { await SaveUpdatedBackupAsync(); });
    private async void SaveAndPublish(object sender, RoutedEventArgs e) => await RunAsync("Сохранение и публикация...", async () =>
    {
        if (Password.Password.Length == 0) throw new InvalidOperationException("Введите пароль сайта на вкладке Публикация.");
        var output = await SaveUpdatedBackupAsync();
        if (output != null) await PublishAsync(output);
    });
    private void WindowClosing(object? sender, CancelEventArgs e)
    {
        if (busy) { e.Cancel = true; MessageBox.Show(this, "Дождитесь завершения текущей операции.", "Offers Base"); }
        else
        {
            settingsSaveTimer.Stop();
            try { SaveSettings(); }
            catch (Exception error)
            {
                e.Cancel = MessageBox.Show(this, "Не удалось сохранить настройки. Закрыть без сохранения?\n" + error.Message,
                    "Offers Base", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes;
            }
        }
    }
}
