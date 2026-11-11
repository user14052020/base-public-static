using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;

namespace OffersBase.Desktop;

public sealed record OrganizationOption(string Id, string Name);
public sealed record InvoiceOption(string Id, string Label);

public sealed class PaymentRow : INotifyPropertyChanged
{
    public string PaymentId { get; init; } = "";
    public string Date { get; init; } = "";
    public decimal OriginalAmount { get; init; }
    public string Payer { get; init; } = "";
    public string Purpose { get; init; } = "";
    public string Reason { get; init; } = "";
    public bool CanSelect { get; init; }
    public ObservableCollection<InvoiceOption> Invoices { get; init; } = [];
    private string invoiceId = "";
    private bool included;
    private string allocationAmount = "";
    public string InvoiceId
    {
        get => invoiceId;
        set { invoiceId = value ?? ""; Included = CanSelect && invoiceId.Length > 0; Notify(); }
    }
    public bool Included { get => included; set { included = value; Notify(); } }
    public string AllocationAmount { get => allocationAmount; set { allocationAmount = value; Notify(); } }
    public decimal ParseAmount()
    {
        if (!decimal.TryParse(AllocationAmount.Replace(" ", "").Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var result) || result <= 0 || decimal.Round(result, 2) != result)
            throw new InvalidOperationException("Введите положительную сумму распределения с точностью до копеек.");
        return result;
    }
    public void Initialize(string selectedId, bool selected, decimal amount)
    {
        invoiceId = selectedId;
        included = selected;
        allocationAmount = amount.ToString("0.00", CultureInfo.InvariantCulture);
    }
    public PaymentRow Split()
    {
        var row = new PaymentRow { PaymentId = PaymentId, Date = Date, OriginalAmount = OriginalAmount, Payer = Payer,
            Purpose = Purpose, Reason = "Разделение платежа", CanSelect = CanSelect, Invoices = Invoices };
        row.Initialize("", false, 0);
        return row;
    }
    public event PropertyChangedEventHandler? PropertyChanged;
    private void Notify([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
