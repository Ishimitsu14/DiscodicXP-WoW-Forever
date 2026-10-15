import { readFile } from 'node:fs/promises';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';

export function createVM() {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  function run(code, name = 'test', addon = false) {
    const loaded = lauxlib.luaL_loadbuffer(state, to_luastring(code), null, to_luastring(name));
    if (loaded !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
    if (addon) {
      lua.lua_pushstring(state, to_luastring('DiscodicXP'));
      lua.lua_getglobal(state, to_luastring('addon'));
    }
    if (lua.lua_pcall(state, addon ? 2 : 0, 0, 0) !== lua.LUA_OK) {
      throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
    }
  }
  return {
    run,
    setBytes(name, bytes) {
      const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      lua.lua_pushlstring(state, value, value.length);
      lua.lua_setglobal(state, to_luastring(name));
    },
    bindBytes(name, callback) {
      lua.lua_pushcfunction(state, current => {
        try {
          const value = callback(Buffer.from(lua.lua_tolstring(current, 1)));
          if (value == null) lua.lua_pushnil(current);
          else lua.lua_pushlstring(current, value, value.length);
        } catch {
          lua.lua_pushnil(current);
        }
        return 1;
      });
      lua.lua_setglobal(state, to_luastring(name));
    },
    async file(path, addon = true) { run(await readFile(path, 'utf8'), path, addon); },
    close() { lua.lua_close(state); }
  };
}
