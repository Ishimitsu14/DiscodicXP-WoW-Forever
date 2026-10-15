local addonName, addon = ...

local theme = CopyTable(addon.themes["DXP Blue"])
theme.name = "Forever"
theme.displayName = "Forever — Азерот"
theme.author = "DiscodicXP"
theme.background = {0.075, 0.065, 0.055, 0.97}
theme.bottomFrameBG = {0.11, 0.085, 0.065, 1}
theme.bottomFrameHighlight = {0.55, 0.35, 0.15, 1}
theme.textColor = {0.92, 0.87, 0.76, 1}
theme.mapPins = {0.88, 0.70, 0.36, 1}
theme.tooltip = "|cffe0bd7a"
theme.bgTextures = {
    edge = "Interface/BUTTONS/WHITE8X8",
    bottom = "Interface/BUTTONS/WHITE8X8",
    guideName = "Interface/BUTTONS/WHITE8X8"
}
addon.themes.Forever = theme

local modern = CopyTable(addon.v2.themes["DXP Blue V2"])
modern.name = "Forever"
modern.displayName = theme.displayName
modern.author = theme.author
modern.mapPins = theme.mapPins
modern.headerTexture = {
    path = "Interface/AddOns/" .. addonName .. "/Textures/Forever/header",
    texCoords = {0, 1, 0, 1}
}
modern.guideWindow.logo = "Interface/Icons/INV_Misc_Map_01"
modern.backgroundColors = {
    common = {0.075, 0.065, 0.055, 0.97},
    guideName = {0.14, 0.10, 0.065, 1},
    guideWindow = {0.09, 0.07, 0.05, 0.98},
    scrollbar = {0.035, 0.03, 0.025, 1},
    inactivePartyTab = {0.16, 0.12, 0.08, 1},
    activeStepCheckbox = {0.055, 0.045, 0.035, 1},
    activeStepCheckboxChecked = {0.42, 0.13, 0.10, 1}
}
modern.borderColors = {
    common = {0.43, 0.31, 0.16, 1},
    commonEdge = {0.66, 0.49, 0.25, 1},
    inactivePartyTab = {0.32, 0.23, 0.13, 1},
    activeStepCheckboxChecked = {0.88, 0.70, 0.36, 1}
}
modern.textColor = {
    common = {0.92, 0.87, 0.76, 1},
    title = {0.88, 0.74, 0.48, 1},
    inactivePartyTab = {0.62, 0.55, 0.43, 1}
}
addon.v2.themes.Forever = modern

addon.guideTextColors.default.DXP_FRIENDLY_ = "FF9BCB8B"
addon.guideTextColors.default.DXP_ENEMY_ = "FFDA8A72"
addon.guideTextColors.default.DXP_LOOT_ = "FF8DBFC6"
addon.guideTextColors.default.DXP_WARN_ = "FFE0BD7A"
