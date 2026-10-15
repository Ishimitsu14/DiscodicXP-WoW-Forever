import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createVM } from './lua-vm.mjs';

test('character metadata is persisted without making guide loading depend on Battle.net', async () => {
  for (const online of [false, true]) {
    const vm = createVM();
    try {
      vm.run(`addon={} DXPCData={currentStep=12}
        function UnitGUID() return 'Player-1-ABC' end
        function UnitName() return 'Тест' end
        function GetRealmName() return 'Хроми' end
        function CreateFrame() return {RegisterEvent=function() end,SetScript=function(self,event,callback) onEvent=callback end} end
        ${online ? 'function BNGetInfo() return 1, "Test#1234" end' : ''}`);
      await vm.file(fileURLToPath(new URL('../addon/SyncIdentity.lua', import.meta.url)));
      vm.run(`onEvent()
        assert(DXPCData.currentStep == 12)
        assert(DXPCData.syncIdentity.guid == 'Player-1-ABC')
        assert(DXPCData.syncIdentity.name == 'Тест')
        assert(DXPCData.syncIdentity.realm == 'Хроми')
        assert(DXPCData.syncIdentity.battleTag ${online ? '== "Test#1234"' : '== nil'})
        BNGetInfo=function() error('offline') end
        onEvent()
        assert(DXPCData.currentStep == 12)`);
    } finally { vm.close(); }
  }
  assert.ok(true);
});
