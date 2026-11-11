using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace OffersBase.Desktop;

public sealed class BackendClient
{
    public async Task<JsonElement> ExecuteAsync(object request)
    {
        var root = AppContext.BaseDirectory;
        var node = Path.Combine(root, "runtime", "node.exe");
        var backend = Path.Combine(root, "scripts", "desktop-api.cjs");
        if (!File.Exists(node) || !File.Exists(backend))
            throw new InvalidOperationException("Не найдены компоненты приложения. Распакуйте весь ZIP, не только OffersBase.exe.");
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo(node)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = root
            }
        };
        process.StartInfo.ArgumentList.Add(backend);
        if (!process.Start()) throw new InvalidOperationException("Не удалось запустить обработку.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request));
            process.StandardInput.Close();
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            await process.WaitForExitAsync(timeout.Token);
            var output = await stdout;
            _ = await stderr;
            using var json = JsonDocument.Parse(output);
            if (!json.RootElement.GetProperty("ok").GetBoolean())
                throw new InvalidOperationException(json.RootElement.GetProperty("error").GetString());
            return json.RootElement.GetProperty("result").Clone();
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new InvalidOperationException("Превышено время ожидания. Проверьте доступ к GitHub и SSH-ключ.");
        }
    }
}
