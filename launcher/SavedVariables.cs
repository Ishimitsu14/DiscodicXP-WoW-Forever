using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace DiscodicXP.Launcher;

public sealed class SavedVariables
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private static readonly HashSet<string> Allowed = ["DXPCData", "DXPCTrackingData", "DXPCComms", "DXPCSettings"];
    private static readonly Regex IdentifierPattern = new(@"\G[a-zA-Z_][a-zA-Z0-9_]*", RegexOptions.CultureInvariant);
    private static readonly Regex NumberPattern = new(@"\G-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", RegexOptions.CultureInvariant);
    private readonly string source;
    private int position, nodes;

    private SavedVariables(string content)
    {
        if (Encoding.UTF8.GetByteCount(content) > MaxBytes) throw Invalid();
        source = content;
    }

    private static InvalidOperationException Invalid() => new("Файл прогресса повреждён или содержит неподдерживаемые данные. Изменения не применены.");

    public static Dictionary<string, object?> Parse(string content)
    {
        var parser = new SavedVariables(content);
        var result = new Dictionary<string, object?>();
        parser.Space();
        while (parser.position < content.Length)
        {
            var name = parser.Identifier();
            if (!Allowed.Contains(name) || result.ContainsKey(name)) throw Invalid();
            parser.Expect('=');
            result[name] = parser.Value(0);
            parser.Space();
        }
        if (!result.TryGetValue("DXPCData", out var data) || data is not Dictionary<object, object?>) throw Invalid();
        return result;
    }

    public static CharacterIdentity Identity(string content)
        => TryIdentity(content) ?? throw new InvalidOperationException("Обнови аддон, войди этим персонажем и нормально выйди из WoW. После этого повтори поиск.");

    public static CharacterIdentity? TryIdentity(string content)
    {
        var data = (Dictionary<object, object?>)Parse(content)["DXPCData"]!;
        if (!data.TryGetValue("syncIdentity", out var value) || value is not Dictionary<object, object?> identity)
            return null;
        string Field(string name, int max)
        {
            if (!identity.TryGetValue(name, out var item) || item is not string text || string.IsNullOrWhiteSpace(text)
                || text.Length > max || text.Any(char.IsControl)) throw Invalid();
            return text;
        }
        var guid = Field("guid", 80);
        if (!Regex.IsMatch(guid, "^Player-[A-Za-z0-9-]+$")) throw Invalid();
        return new CharacterIdentity(guid, Field("name", 64), Field("realm", 128));
    }

    private void Space()
    {
        while (position < source.Length)
        {
            if (char.IsWhiteSpace(source[position]) || source[position] == '\uFEFF') { position++; continue; }
            if (!source.AsSpan(position).StartsWith("--")) break;
            position += 2;
            if (LongBracket()) continue;
            while (position < source.Length && source[position] != '\n') position++;
        }
    }

    private bool LongBracket()
    {
        if (position >= source.Length || source[position] != '[') return false;
        var start = position + 1;
        while (start < source.Length && source[start] == '=') start++;
        if (start >= source.Length || source[start] != '[') return false;
        var end = "]" + new string('=', start - position - 1) + "]";
        var close = source.IndexOf(end, start + 1, StringComparison.Ordinal);
        if (close < 0) throw Invalid();
        position = close + end.Length;
        return true;
    }

    private void Expect(char expected)
    {
        Space();
        if (position >= source.Length || source[position++] != expected) throw Invalid();
    }

    private string Identifier()
    {
        Space();
        var match = IdentifierPattern.Match(source, position);
        if (!match.Success) throw Invalid();
        position += match.Length;
        return match.Value;
    }

    private object? Value(int depth)
    {
        if (depth > 64 || ++nodes > 150000) throw Invalid();
        Space();
        if (position >= source.Length) throw Invalid();
        var current = source[position];
        if (current is '\'' or '"') return String();
        if (current == '{')
        {
            position++;
            var table = new Dictionary<object, object?>();
            double index = 0;
            Space();
            while (position < source.Length && source[position] != '}')
            {
                object key;
                object? value;
                if (source[position] == '[')
                {
                    position++;
                    key = Value(depth + 1) ?? throw Invalid();
                    if (key is not string and not double) throw Invalid();
                    Expect(']'); Expect('='); value = Value(depth + 1);
                }
                else
                {
                    var saved = position;
                    var match = IdentifierPattern.Match(source, position);
                    if (match.Success)
                    {
                        position += match.Length; Space();
                        if (position < source.Length && source[position] == '=')
                        { position++; key = match.Value; value = Value(depth + 1); }
                        else { position = saved; key = ++index; value = Value(depth + 1); }
                    }
                    else { key = ++index; value = Value(depth + 1); }
                }
                if (!table.TryAdd(key, value)) throw Invalid();
                Space();
                if (position < source.Length && source[position] is ',' or ';') { position++; Space(); }
                else if (position >= source.Length || source[position] != '}') throw Invalid();
            }
            Expect('}'); return table;
        }
        if (current is '-' or '+' || char.IsAsciiDigit(current))
        {
            var match = NumberPattern.Match(source, position);
            if (!match.Success || !double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || !double.IsFinite(number)) throw Invalid();
            position += match.Length; return number;
        }
        return Identifier() switch { "true" => true, "false" => false, "nil" => null, _ => throw Invalid() };
    }

    private string String()
    {
        var quote = source[position++];
        using var bytes = new System.IO.MemoryStream();
        while (position < source.Length)
        {
            var start = position;
            while (position < source.Length && source[position] != quote && source[position] != '\\')
            {
                if (source[position] is '\r' or '\n') throw Invalid();
                position++;
            }
            bytes.Write(Encoding.UTF8.GetBytes(source[start..position]));
            if (position >= source.Length) throw Invalid();
            if (source[position++] == quote) return new UTF8Encoding(false, true).GetString(bytes.ToArray());
            if (position >= source.Length) throw Invalid();
            var escaped = source[position++];
            if (char.IsAsciiDigit(escaped))
            {
                var value = escaped - '0';
                for (var i = 0; i < 2 && position < source.Length && char.IsAsciiDigit(source[position]); i++) value = value * 10 + source[position++] - '0';
                if (value > 255) throw Invalid();
                bytes.WriteByte((byte)value);
            }
            else
            {
                if (escaped == '\r' && position < source.Length && source[position] == '\n') position++;
                bytes.WriteByte(escaped switch { 'a' => 7, 'b' => 8, 'f' => 12, 'n' => 10, 'r' => 13, 't' => 9, 'v' => 11,
                    '\\' => 92, '\'' => 39, '"' => 34, '\r' or '\n' => 10, _ => throw Invalid() });
            }
        }
        throw Invalid();
    }
}
