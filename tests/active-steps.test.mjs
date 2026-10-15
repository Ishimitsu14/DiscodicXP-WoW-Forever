import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import luaparse from 'luaparse';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');

function functionName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return functionName(node.base) + node.indexer + node.identifier.name;
  return '';
}

async function loadFunctions(vm, names) {
  const source = await readFile(resolve(root, 'GuideWindow.lua'), 'utf8');
  const ast = luaparse.parse(source, { ranges: true, luaVersion: '5.1' });
  for (const name of names) {
    const node = ast.body.find(node => node.type === 'FunctionDeclaration' && node.identifier && functionName(node.identifier) === name);
    if (!node) throw new Error(`Missing engine function: ${name}`);
    vm.run('local _, addon = ...\nlocal AceGUI = LibStub("AceGUI-3.0")\n' + source.slice(...node.range), name, true);
  }
}

async function loadElementMethods(vm) {
  const source = await readFile(resolve(root, 'UI/V2/Core.lua'), 'utf8');
  const ast = luaparse.parse(source, { ranges: true, luaVersion: '5.1' });
  const register = ast.body.find(node => node.type === 'FunctionDeclaration' && node.identifier &&
    functionName(node.identifier) === 'addon.ui.v2:RegisterDXPV2ActiveStepItem');
  const methods = register.body.find(node => node.type === 'LocalStatement' &&
    node.variables.some(variable => variable.name === 'methods')).init[0];
  const setter = methods.fields.find(field => field.key.raw === '"SetElements"').value;
  vm.run(`
    local addon = addon
    local function createElementRow() error("Unexpected row allocation") end
    local function releaseElementRow(row)
        addon.ReleaseActiveStepElement(row)
        row.released = true
    end
    setElements = ${source.slice(...setter.range)}
  `);
}

const environment = `
local function container()
    return {
        children = {},
        SetLayout = function() end,
        Show = function(self) self.shown = true end
    }
end
LibStub = function() return {Create = function(self, kind)
    assert(kind == "DXPV2ActiveStepsFrame")
    return container()
end} end
addon = {
    player = {name = "Self"},
    settings = {profile = {enableV2Interface = true, enableBetaFeatures = false}, LoadFramePosition = function() end},
    enabledFrames = {},
    v2 = {state = {player = {}}},
    UpdateMap = function() mapUpdated = true end,
    comms = {grouping = {
        CanBroadcastCurrentStep = function() broadcastChecked = true; return true end,
        BroadcastCurrentStep = function() broadcastSent = true; return true end
    }}
}
function addon.v2:IsGuideWindowEnabled() return addon.settings.profile.enableV2Interface end
function addon.v2:IsActivePartyStepsAvailable() return addon.settings.profile.enableBetaFeatures end
function addon.v2:SetActiveStepsFrameAnchor(frame) anchored = frame end
function addon.v2:ClearActiveStepEventWatchers() watchersCleared = true end
function addon.v2:UpdateActiveStepEventWatchers(steps) watched = steps end
function addon.v2:GetActiveStepText(step) return step.text end
function addon.v2:EncodePlayerActiveSteps() return "payload" end
function addon.v2:ReconcileActiveStepItems(state, steps, widgetType) rendered = steps; assert(widgetType == "DXPV2ActiveStepItem") end
`;

test('local current steps render with experimental features disabled', async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await loadFunctions(vm, ['addon.v2:GetActiveStepsFrame', 'addon.v2:UpdateActiveStepsFrame']);
    vm.run(`
      local frame = addon.v2:GetActiveStepsFrame("Self")
      assert(frame and frame.shown, "Current steps are hidden behind the experimental flag")
      assert(anchored == frame)
      assert(addon.v2:GetActiveStepsFrame("Other") == nil)
      local steps = {{active = true, text = "Quest objective"}}
      addon.v2:UpdateActiveStepsFrame(steps)
      assert(watched == steps, "Objective event watchers were not enabled")
      assert(rendered == steps, "Current objectives were not rendered")
      assert(not broadcastChecked and not broadcastSent)
      addon.settings.profile.enableV2Interface = false
      addon.v2:UpdateActiveStepsFrame(steps)
      assert(watchersCleared)
    `);
  } finally { vm.close(); }
});

test('manual objective checkbox updates only that objective and refreshes progress', async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await loadFunctions(vm, ['addon.ActiveStepElementPostClick']);
    vm.run(`
      local completed = 0
      local objective = {OnComplete = function() completed = completed + 1 end}
      local other = {}
      local checked = true
      local button = {GetParent = function() return {element = objective} end, GetChecked = function() return checked end}
      addon.ActiveStepElementPostClick(button)
      assert(objective.skip and not other.skip)
      assert(completed == 1 and addon.updateSteps and mapUpdated)
      addon.ActiveStepElementPostClick(button)
      assert(completed == 1)
      checked = false
      addon.ActiveStepElementPostClick(button)
      assert(not objective.skip)
      objective.optional = true
      checked = true
      addon.ActiveStepElementPostClick(button)
      assert(not objective.skip)
    `);
  } finally { vm.close(); }
});

test('objective callbacks defer recursive watcher updates until the next refresh', async () => {
  const vm = createVM();
  try {
    vm.run(environment + `
      tinsert = table.insert
      table.wipe = function(t) for key in pairs(t) do t[key] = nil end end
      addon.functions = {events = {collect = "BAG_UPDATE_DELAYED"}}
      addon.Call = function(label, callback, ...) return callback(...) end
      watcher = {elementRows = {}, activeElementRows = 0}
      addon.v2.state.activeStepEventWatcher = watcher
      for index = 1, 11 do
          watcher.elementRows[index] = {
              button = {Enable = function() end},
              events = {},
              RegisterEvent = function(self, event) self.events[event] = true end,
              UnregisterAllEvents = function(self) self.events = {} end,
              SetScript = function(self, event, callback) self[event] = callback end
          }
      end
    `);
    await loadElementMethods(vm);
    await loadFunctions(vm, ['addon.ActiveStepElementEventHandler', 'addon.BindActiveStepElement', 'addon.ReleaseActiveStepElement',
      'addon.v2:GetActiveStepsFrame', 'addon.v2:UpdateActiveStepEventWatchers', 'addon.v2:UpdateActiveStepsFrame']);
    vm.run(`
      watcher.SetElements = setElements
      local step = {active = true, index = 104, elements = {}}
      for index = 1, 11 do step.elements[index] = {tag = "collect", step = step} end
      local calls = 0
      local recursive = true
      addon.functions.collect = function(row)
          calls = calls + 1
          if recursive then
              recursive = false
              row.element.text = "Collected item"
              addon.v2:UpdateActiveStepsFrame({step})
          end
      end
      addon.v2:UpdateActiveStepsFrame({step})
      assert(calls == 11, "An objective was bound recursively")
      assert(watcher.activeElementRows == 11)
      assert(addon.updateStepText, "The recursive refresh was lost")
      addon.updateStepText = false
      addon.v2:UpdateActiveStepsFrame({step})
      assert(watcher.activeElementRows == 10, "Visible objectives are still watched twice")
      for index = 1, 10 do
          local row = watcher.elementRows[index]
          assert(row.element == step.elements[index + 1])
          assert(row.events.BAG_UPDATE_DELAYED and row.OnEvent)
      end
      local released = watcher.elementRows[11]
      assert(released.released and not released.element and not released.OnEvent)
      assert(next(released.events) == nil)
      addon.v2:UpdateActiveStepsFrame({})
      assert(watcher.activeElementRows == 0)
      for _, element in ipairs(step.elements) do assert(not element.frame) end
      watcher.SetElements = function() error("Callback failed") end
      local success, err = pcall(addon.v2.UpdateActiveStepsFrame, addon.v2, {step})
      assert(not success and err:find("Callback failed", 1, true))
      assert(not addon.v2.state.updatingActiveStepEventWatchers, "A failed callback blocked later refreshes")
      watcher.SetElements = setElements
      addon.v2:UpdateActiveStepsFrame({step})
      assert(watcher.activeElementRows == 10)
    `);
  } finally { vm.close(); }
});
