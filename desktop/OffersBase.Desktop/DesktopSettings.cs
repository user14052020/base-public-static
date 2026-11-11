using System.IO;
using System.Text.Json;

namespace OffersBase.Desktop;

public sealed record DesktopSettings
{
    public string RepoPath { get; init; } = "";
    public string RepositoryUrl { get; init; } = "https://github.com/user14052020/base-public-static.git";
    public string AuthorName { get; init; } = "";
    public string AuthorEmail { get; init; } = "";
    public string GithubLogin { get; init; } = "user14052020";
}

public sealed class DesktopSettingsStore(string filename)
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public DesktopSettings Load()
    {
        if (!File.Exists(filename)) return new();
        try { return JsonSerializer.Deserialize<DesktopSettings>(File.ReadAllText(filename), Options) ?? new(); }
        catch (JsonException) { return new(); }
    }
    public void Save(DesktopSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(filename))!);
        var temporary = filename + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                JsonSerializer.Serialize(stream, settings, Options);
            File.Move(temporary, filename, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
