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
