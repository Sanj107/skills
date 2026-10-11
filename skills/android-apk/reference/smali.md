# Smali quick reference

Smali is the assembly language for Dalvik/ART bytecode. `apktool d` writes one `.smali` file per
class under `smali/` (`smali_classes2/` etc. for multidex). Use `apk.sh decompile` (jadx) to
*read* logic as Java, and edit smali to *change* it.

## Types and names

| Java | Smali | | Java | Smali |
|---|---|---|---|---|
| `void` | `V` | | `long` | `J` (2 registers) |
| `boolean` | `Z` | | `double` | `D` (2 registers) |
| `int` | `I` | | `float` | `F` |
| `byte`/`short`/`char` | `B`/`S`/`C` | | `int[]` | `[I` |
| `String` | `Ljava/lang/String;` | | `Foo$Bar` (inner) | `Lcom/x/Foo$Bar;` |

Method reference: `Lcom/x/Foo;->name(ILjava/lang/String;)Z` = `boolean name(int, String)`.
Field reference: `Lcom/x/Foo;->count:I`.

## Registers

`.registers N` = total registers; parameters occupy the **last** ones and are aliased
`p0..` (`p0` = `this` for instance methods). Locals are `v0..`. If you need another local,
raise `.registers` (keeping params last is automatic). `.locals N` counts locals only.
Most instructions take only `v0..v15`; use `/from16` or `/range` forms beyond that.

## Common instructions

```smali
const/4 v0, 0x1                    # small int (-8..7); const/16, const, const-wide
const-string v1, "text"
move-result v0                      # after invoke-* returning a primitive
move-result-object v0               # ... returning an object
invoke-virtual {p0, v1}, Lcom/x/Foo;->bar(Ljava/lang/String;)V
invoke-static {v0}, Ljava/lang/String;->valueOf(I)Ljava/lang/String;
invoke-direct {v0}, Lcom/x/Foo;-><init>()V       # constructors and private methods
invoke-super / invoke-interface
iget-object v0, p0, Lcom/x/Foo;->name:Ljava/lang/String;   # instance field (iput-* to write)
sget-boolean v0, Lcom/x/Config;->DEBUG:Z                    # static field (sput-* to write)
new-instance v0, Lcom/x/Foo;
if-eqz v0, :label                   # if-nez, if-eq, if-lt, ...
goto :label
return-void / return v0 / return-object v0
```

## Typical edits

Force a boolean method (e.g. a debug-logging switch) to return true:

```smali
.method public isDebugLoggingEnabled()Z
    .registers 1
    const/4 v0, 0x1
    return v0
.end method
```

Log a value (Android `Log.d`):

```smali
const-string v2, "MYTAG"
invoke-static {v2, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I
```

## Gotchas

- **Non-ASCII strings are escaped**: baksmali writes `"Привет"` as
  `"Привет"`. Search/replace the escaped form, e.g.
  `python3 -c "print('Привет'.encode('unicode_escape').decode())"`.
- Resource ids are hard-coded ints (`const v0, 0x7f0b0012`); find names in
  `res/values/public.xml`. Adding a resource does not renumber existing ones.
- Obfuscated apps (R8/ProGuard) have short names like `La/b/c;` — use jadx to navigate,
  then edit the matching smali.
- Don't change method signatures other classes call; the verifier will reject the app at run
  time (`VerifyError`), not at build time.
- Multidex limit: 65,536 method references per dex. If adding many methods, put new
  classes in a new `smali_classesN/` folder.
