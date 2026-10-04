/*
 * VividShade: Multi-Monitor RGB Dimming Control
 *
 * This GNOME Shell extension is inspired by and based upon the functionality of the
 * "Dim Desktop 70" extension (https://extensions.gnome.org/extension/1130/dim-desktop-70/).
 * It has been enhanced to provide individual dimming controls for multi-monitor setups,
 * complete with RGB color customization for a personalized ambiance.
 *
 * GNOME Shell 50 port.
 *
 * For feedback, suggestions, or bug reports, feel free to reach out:
 * Maciej Mozolewski <m.mozolewski@gmail.com>
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

let dimmerButton = null;
let dimmerOverlays = {};

// Default to orange (255, 165, 0), but darker.
let colorValues = {
    red: 128,
    green: 83,
    blue: 0,
};

let colorEnabled = {};
let globalDimValue = 0.0;
let dimmingEnabled = true;
let monitorDimValues = {};

function destroyOverlays() {
    Object.values(dimmerOverlays).forEach(overlay => {
        overlay?.destroy();
    });
    dimmerOverlays = {};
}

const DimmerMenuButton = GObject.registerClass(
class DimmerMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Dimmer Menu'), false);

        this._monitorSliders = [];
        this._colorSwitchItems = [];

        this._createIcon();
        this._buildMenu();

        this._monitorChangedSignal = Main.layoutManager.connect(
            'monitors-changed',
            () => this._rebuildSliders()
        );
    }

    _createIcon() {
        const icon = new St.Icon({
            icon_name: 'display-brightness-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);
    }

    _buildMenu() {
        this._monitorSliders = [];
        this._colorSwitchItems = [];

        this._createGlobalControls();
        this._createSliders();
        this._createColorSliders();
    }

    _createGlobalControls() {
        const dimmingSwitchItem = new PopupMenu.PopupSwitchMenuItem(
            _('Dimming'),
            dimmingEnabled
        );
        dimmingSwitchItem.connect('toggled', (_item, state) => {
            this._onDimmingToggled(state);
        });
        this.menu.addMenuItem(dimmingSwitchItem);
        this._dimmingSwitchItem = dimmingSwitchItem;

        const globalSliderItem = new PopupMenu.PopupBaseMenuItem({
            activate: false,
        });

        const globalSliderLabel = new St.Label({
            text: _('Global Dimming'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        globalSliderItem.add_child(globalSliderLabel);

        const globalSlider = new Slider(globalDimValue);
        globalSlider.x_expand = true;
        globalSlider.connect('notify::value', slider => {
            this._onGlobalDimValueChanged(slider.value);
        });
        globalSliderItem.add_child(globalSlider);
        this.menu.addMenuItem(globalSliderItem);

        const globalColorSwitchItem = new PopupMenu.PopupSwitchMenuItem(
            _('Global Color Switch'),
            false
        );
        globalColorSwitchItem.connect('toggled', (_item, state) => {
            this._onGlobalColorToggled(state);
        });
        this.menu.addMenuItem(globalColorSwitchItem);

        this._globalColorSwitchItem = globalColorSwitchItem;
    }

    _createSliders() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        Main.layoutManager.monitors.forEach((_monitor, index) => {
            const sliderItem = new PopupMenu.PopupBaseMenuItem({
                activate: false,
            });

            const monitorLabel = new St.Label({
                text: `Monitor #${index + 1}`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            sliderItem.add_child(monitorLabel);

            const monitorDimValue = monitorDimValues[index] ?? globalDimValue;
            monitorDimValues[index] = monitorDimValue;

            const slider = new Slider(monitorDimValue);
            slider.x_expand = true;
            slider.connect('notify::value', currentSlider => {
                this._onSliderValueChanged(currentSlider.value, index);
            });
            sliderItem.add_child(slider);
            this.menu.addMenuItem(sliderItem);

            this._monitorSliders.push({
                monitorIndex: index,
                slider,
            });

            const colorSwitchItem = new PopupMenu.PopupSwitchMenuItem(
                _('Color Switch'),
                false
            );
            colorSwitchItem._monitorIndex = index;
            colorEnabled[index] = false;
            colorSwitchItem.connect('toggled', (_item, state) => {
                colorEnabled[index] = state;
                this._onColorToggle(state, index);
            });
            this.menu.addMenuItem(colorSwitchItem);
            this._colorSwitchItems.push(colorSwitchItem);
        });
    }

    _createColorSliders() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        [
            ['red', 'R:'],
            ['green', 'G:'],
            ['blue', 'B:'],
        ].forEach(([color, label]) => {
            const colorSliderItem = new PopupMenu.PopupBaseMenuItem({
                activate: false,
            });

            const colorLabel = new St.Label({
                text: label,
                width: 28,
                y_align: Clutter.ActorAlign.CENTER,
            });
            colorSliderItem.add_child(colorLabel);

            const colorSlider = new Slider(colorValues[color] / 255);
            colorSlider.x_expand = true;
            colorSlider.connect('notify::value', slider => {
                colorValues[color] = Math.floor(slider.value * 255);
                this._updateColorOverlays();
            });
            colorSliderItem.add_child(colorSlider);

            this.menu.addMenuItem(colorSliderItem);
        });
    }

    _onDimmingToggled(state) {
        dimmingEnabled = state;

        this._monitorSliders.forEach(({monitorIndex, slider}) => {
            this._onSliderValueChanged(slider.value, monitorIndex);
        });
    }

    _onGlobalDimValueChanged(value) {
        globalDimValue = value;

        // Setting the public Slider.value property updates the handle and emits
        // notify::value when the value actually changes.
        this._monitorSliders.forEach(({slider}) => {
            if (slider.value !== value)
                slider.value = value;
        });
    }

    _onGlobalColorToggled(state) {
        this._colorSwitchItems.forEach(switchItem => {
            const monitorIndex = switchItem._monitorIndex;
            colorEnabled[monitorIndex] = state;
            switchItem.setToggleState(state);
            this._onColorToggle(state, monitorIndex);
        });
    }

    _onSliderValueChanged(value, monitorIndex) {
        monitorDimValues[monitorIndex] = value;

        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor)
            return;

        if (!dimmingEnabled) {
            dimmerOverlays[monitorIndex]?.set_opacity(0);
            return;
        }

        const opacity = Math.floor(value * 255);

        if (!dimmerOverlays[monitorIndex])
            this._createOverlay(monitor, monitorIndex);

        dimmerOverlays[monitorIndex].set_opacity(opacity);
        this._updateColorOverlay(monitorIndex);
    }

    _createOverlay(monitor, monitorIndex) {
        const overlay = new Clutter.Actor({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            background_color: new Cogl.Color({
                red: 0,
                green: 0,
                blue: 0,
                alpha: 255,
            }),
            opacity: 0,
        });

        Main.uiGroup.add_child(overlay);
        dimmerOverlays[monitorIndex] = overlay;
    }

    _onColorToggle(state, monitorIndex) {
        const overlay = dimmerOverlays[monitorIndex];
        if (!overlay)
            return;

        if (state) {
            this._updateColorOverlay(monitorIndex);
        } else {
            overlay.set_background_color(new Cogl.Color({
                red: 0,
                green: 0,
                blue: 0,
                alpha: overlay.get_opacity(),
            }));
        }
    }

    _updateColorOverlay(monitorIndex) {
        const overlay = dimmerOverlays[monitorIndex];
        if (!overlay)
            return;

        if (colorEnabled[monitorIndex]) {
            overlay.set_background_color(new Cogl.Color({
                red: colorValues.red,
                green: colorValues.green,
                blue: colorValues.blue,
                alpha: overlay.get_opacity(),
            }));
        } else {
            overlay.set_background_color(new Cogl.Color({
                red: 0,
                green: 0,
                blue: 0,
                alpha: overlay.get_opacity(),
            }));
        }
    }

    _updateColorOverlays() {
        Object.keys(dimmerOverlays).forEach(monitorIndex => {
            this._updateColorOverlay(monitorIndex);
        });
    }

    _rebuildSliders() {
        destroyOverlays();
        colorEnabled = {};

        // The panel icon is not part of this.menu, so only rebuild the popup.
        this.menu.removeAll();
        this._buildMenu();

        // Restore the remembered per-monitor dim levels on the newly detected monitors.
        if (dimmingEnabled) {
            this._monitorSliders.forEach(({monitorIndex, slider}) => {
                this._onSliderValueChanged(slider.value, monitorIndex);
            });
        }
    }

    destroy() {
        if (this._monitorChangedSignal) {
            Main.layoutManager.disconnect(this._monitorChangedSignal);
            this._monitorChangedSignal = 0;
        }

        super.destroy();
    }
});

export default class VividShadeExtension extends Extension {
    enable() {
        dimmerButton = new DimmerMenuButton();
        Main.panel.addToStatusArea('dimmerMenu', dimmerButton, 1, 'right');
    }

    disable() {
        dimmerButton?.destroy();
        dimmerButton = null;

        destroyOverlays();
        colorEnabled = {};
        globalDimValue = 0.0;
        dimmingEnabled = true;
        monitorDimValues = {};
        colorValues = {
            red: 128,
            green: 83,
            blue: 0,
        };
    }
}
