using OffersBase.Desktop;
using System.Text.Json;

var parent = Path.GetFullPath(Path.GetTempPath());
var directory = Path.Combine(parent, "offers-settings-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
try
{
    var file = Path.Combine(directory, "settings.json");
    var store = new DesktopSettingsStore(file);
    Check(store.Load().RepositoryUrl.StartsWith("https://"), "Default HTTPS URL");
    File.WriteAllText(file, "{\"repoPath\":\"legacy-repo\"}");
    Check(store.Load().RepoPath == "legacy-repo", "Legacy settings are retained");
    Check(store.Load().AuthorEmail == "", "New fields have defaults");
    var expected = new DesktopSettings { RepoPath = "C:\\test repo", RepositoryUrl = "https://github.com/user14052020/base-public-static.git",
        AuthorName = "Fixture Author", AuthorEmail = "fixture@example.test", GithubLogin = "fixture-user" };
    store.Save(expected);
    Check(new DesktopSettingsStore(file).Load() == expected, "Settings survive a new process/store instance");
    var changed = expected with { AuthorName = "Updated Author", AuthorEmail = "updated@example.test" };
    store.Save(changed);
    Check(store.Load() == changed, "Edited settings replace previous values");
    Check(Directory.GetFiles(directory).Length == 1, "Atomic writes leave no temporary files");
    using (var json = JsonDocument.Parse(File.ReadAllText(file)))
    {
        var names = json.RootElement.EnumerateObject().Select(property => property.Name).Order().ToArray();
        Check(names.SequenceEqual(new[] { "authorEmail", "authorName", "githubLogin", "repoPath", "repositoryUrl" }), "Only non-secret settings are serialized");
    }
    File.WriteAllText(file, "broken JSON");
    Check(store.Load() == new DesktopSettings(), "Malformed old settings do not prevent startup");
    Console.WriteLine("PASS: 8 settings persistence checks");
}
finally
{
    if (!Path.GetFullPath(directory).StartsWith(parent, StringComparison.OrdinalIgnoreCase)
        || !Path.GetFileName(directory).StartsWith("offers-settings-test-", StringComparison.Ordinal)) throw new InvalidOperationException("Unsafe cleanup target");
    Directory.Delete(directory, recursive: true);
}

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
