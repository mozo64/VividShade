/*
 * VividShade: Multi-Monitor RGB Dimming Control
 *
 * This GNOME Shell extension is inspired by and based upon the functionality of the
 * "Dim Desktop 70" extension (https://extensions.gnome.org/extension/1130/dim-desktop-70/).
 * It has been enhanced to provide individual dimming controls for multi-monitor setups,
 * complete with RGB color customization for a personalized ambiance.
 *
 * Compatibility: Tested with Ubuntu 22.04.3 LTS and GNOME Shell 42.9.
 *
 * For feedback, suggestions, or bug reports, feel free to reach out:
 * Maciej Mozolewski <m.mozolewski@gmail.com>
 *
 * Enjoy a more comfortable and customizable visual experience with your monitors!
 */
const St = imports.gi.St;
const Main = imports.ui.main;
const Slider = imports.ui.slider;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;

let dimmerButton, dimmerOverlays = {};
// Default to orange (255, 165, 0), but darker
let colorValues = {
    red: 128,
    green: 83,
    blue: 0
};
let colorEnabled = {}; // Keep track of which monitors have color dimming enabled
let globalDimValue = 0.0; // Keep track of the global dim value

const DimmerMenuButton = GObject.registerClass(
    class DimmerMenuButton extends PanelMenu.Button {
        _init() {
            super._init(0.0, _('Dimmer Menu'), false);
            this._createIcon();
            this._createGlobalControls();
            this._createSliders();
            this._createColorSliders();
            this._monitorChangedSignal = Main.layoutManager.connect('monitors-changed', this._rebuildSliders.bind(this));
        }

        _createIcon() {
            let icon = new St.Icon({
                icon_name: 'display-brightness-symbolic',
                style_class: 'system-status-icon',
            });
            this.add_child(icon);
        }

        _createGlobalControls() {
            if (this.menu._getMenuItems().length > 0) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            // Global Dimming Slider
            let globalSliderItem = new PopupMenu.PopupBaseMenuItem({
                activate: false
            });
            let globalSliderLabel = new St.Label({
                text: _("Global Dimming"),
                y_align: Clutter.ActorAlign.CENTER
            });
            globalSliderItem.actor.add_child(globalSliderLabel, {
                expand: false
            });

            let globalSlider = new Slider.Slider(globalDimValue);
            globalSlider.connect('notify::value', (slider) => {
                this._onGlobalDimValueChanged(slider.value);
            });
            globalSliderItem.actor.add_child(globalSlider.actor, {
                expand: true
            });
            this.menu.addMenuItem(globalSliderItem);

            // Global Color Dimming Switch
            let globalColorSwitchItem = new PopupMenu.PopupSwitchMenuItem(_("Global Color Switch"), false);
            globalColorSwitchItem.connect('toggled', (switchActor, state) => {
                this._onGlobalColorToggled(state);
            });
            this.menu.addMenuItem(globalColorSwitchItem);
        }

        _createSliders() {
            if (this.menu._getMenuItems().length > 0) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            let monitors = Main.layoutManager.monitors;
            monitors.forEach((monitor, index) => {
                // Create a new menu item for the slider
                let sliderItem = new PopupMenu.PopupBaseMenuItem({
                    activate: false
                });
                sliderItem._monitorIndex = index; // Store the monitor index in the menu item

                // Create the slider for dimming
                // Start with 0 opacity (no dimming)
                let slider = new Slider.Slider(globalDimValue + 0.001); // Constant added to fix Global Dim slider not working on forst trial
                slider.connect('notify::value', (slider) => {
                    this._onSliderValueChanged(slider.value, index);
                });
                sliderItem.actor.add_child(slider.actor, {
                    expand: true
                });
                sliderItem._slider = slider; // Store the slider in the menu item for later access

                // Add a Switch for color dimming
                let colorSwitchItem = new PopupMenu.PopupSwitchMenuItem(_("Color Switch"), false);
                colorSwitchItem._monitorIndex = index;
                colorEnabled[index] = false; // Initialize with color dimming off
                colorSwitchItem.connect('toggled', (switchActor, state) => {
                    colorEnabled[index] = state;
                    this._onColorToggle(state, index);
                });

                // Add the monitor label
                let monitorLabel = new St.Label({
                    text: `Monitor #${index + 1}`,
                    y_align: Clutter.ActorAlign.CENTER
                });
                sliderItem.actor.insert_child_at_index(monitorLabel, 0); // Insert at the beginning

                this.menu.addMenuItem(sliderItem);
                this.menu.addMenuItem(colorSwitchItem);
            });
        }

        _createColorSliders() {
            if (this.menu._getMenuItems().length > 0) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            // Create RGB sliders
            ['red', 'green', 'blue'].forEach((color) => {
                let colorLabel = new St.Label({
                    text: `${color.toUpperCase()}:`,
                    y_align: Clutter.ActorAlign.CENTER
                });

                let colorSliderItem = new PopupMenu.PopupBaseMenuItem({
                    activate: false
                });
                colorSliderItem.actor.add_child(colorLabel, {
                    expand: false
                });
                let colorSlider = new Slider.Slider(colorValues[color] / 255);
                colorSlider.connect('notify::value', (slider) => {
                    colorValues[color] = Math.floor(slider.value * 255);
                    this._updateColorOverlays();
                });
                colorSliderItem.actor.add_child(colorSlider.actor, {
                    expand: true
                });
                this.menu.addMenuItem(colorSliderItem);
            });
        }

        _onGlobalDimValueChanged(value) {
            globalDimValue = value;

            // Update the dim value for each monitor
            Object.keys(dimmerOverlays).forEach(monitorIndex => {
                this._onSliderValueChanged(value, monitorIndex);
            });

            // Update the position of each slider in the menu
            let monitorSliderItems = this.menu._getMenuItems().filter(item => item._slider && typeof item._monitorIndex !== 'undefined');
            monitorSliderItems.forEach((sliderItem) => {
                let slider = sliderItem._slider;
                if (typeof slider._moveHandle === 'function') {
                    slider._moveHandle(value);
                } else {
                    log(`Expected a Slider with setValue(), but did not find one: ${slider}`);

                    // Log all methods and properties of the slider object
                    let proto = Object.getPrototypeOf(slider);
                    let props = Object.getOwnPropertyNames(proto);
                    props.forEach((prop) => {
                        let type = typeof proto[prop];
                        if (type === 'function') {
                            log(`Method: ${prop}`);
                        } else {
                            log(`Property: ${prop}`);
                        }
                    });

                }

            });
        }


        _onGlobalColorToggled(state) {
            Object.keys(colorEnabled).forEach(monitorIndex => {
                colorEnabled[monitorIndex] = state;
                this._onColorToggle(state, monitorIndex);
            });
            let colorSwitchItems = this.menu._getMenuItems().filter(item => item._switch && typeof item._monitorIndex !== 'undefined');
            colorSwitchItems.forEach((switchItem) => {
                switchItem.setToggleState(state);
            });
        }

        _onSliderValueChanged(value, monitorIndex) {
            let opacity = Math.floor(value * 255); // Slider value is from 0.0 to 1.0, scale it to 0-255
            let monitor = Main.layoutManager.monitors[monitorIndex];
            if (!dimmerOverlays[monitorIndex]) {
                this._createOverlay(monitor, monitorIndex);
            }
            dimmerOverlays[monitorIndex].set_opacity(opacity);
            this._updateColorOverlay(monitorIndex); // Update the color if color dimming is enabled

        }

        _createOverlay(monitor, monitorIndex) {
            let overlay = new Clutter.Actor({
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                background_color: new Clutter.Color({
                    red: 0,
                    green: 0,
                    blue: 0,
                    alpha: 255
                }),
                opacity: 0 // Start fully transparent
            });
            Main.uiGroup.add_actor(overlay);
            dimmerOverlays[monitorIndex] = overlay;
        }

        _onColorToggle(state, monitorIndex) {
            let overlay = dimmerOverlays[monitorIndex];
            if (overlay) {
                if (state) {
                    this._updateColorOverlay(monitorIndex);
                } else {
                    overlay.set_background_color(new Clutter.Color({
                        red: 0,
                        green: 0,
                        blue: 0,
                        alpha: overlay.get_opacity()
                    }));
                }
            } else {
                dimmerOverlays[monitorIndex] = null;
            }
        }


        _updateColorOverlay(monitorIndex) {
            let overlay = dimmerOverlays[monitorIndex];
            if (overlay) {
                if (colorEnabled[monitorIndex]) {
                    overlay.set_background_color(new Clutter.Color({
                        red: colorValues.red,
                        green: colorValues.green,
                        blue: colorValues.blue,
                        alpha: overlay.get_opacity()
                    }));
                } else {
                    overlay.set_background_color(new Clutter.Color({
                        red: 0,
                        green: 0,
                        blue: 0,
                        alpha: overlay.get_opacity()
                    }));
                }
            } else {
                log(`No overlay found!`);
            }
        }


        _updateColorOverlays() {
            Object.keys(dimmerOverlays).forEach((monitorIndex) => {
                this._updateColorOverlay(monitorIndex);
            });
        }


        _rebuildSliders() {
            // Remove all existing overlays
            Object.values(dimmerOverlays).forEach((overlay) => {
                if (overlay) {
                    Main.uiGroup.remove_actor(overlay);
                    overlay.destroy();
                }
            });
            dimmerOverlays = {};
            colorEnabled = {}; // Reset color enabled state

            // Re-create sliders for the current set of monitors
            this._createIcon();
            this._createGlobalControls();
            this._createSliders();
            this._createColorSliders();

        }

        destroy() {
            Main.layoutManager.disconnect(this._monitorChangedSignal);
            super.destroy();
        }
    });

function init() {

}

function enable() {
    dimmerButton = new DimmerMenuButton();
    Main.panel.addToStatusArea('dimmerMenu', dimmerButton, 1, 'right');
}

function disable() {
    if (dimmerButton) {
        dimmerButton.destroy();
        dimmerButton = null; // Clear the reference to allow garbage collection
    }

    Object.values(dimmerOverlays).forEach((overlay) => {
        if (overlay) {
            Main.uiGroup.remove_actor(overlay);
            overlay.destroy();
        }
    });
    dimmerOverlays = {};
    colorEnabled = {};
    globalDimValue = 0.0;
    colorValues = {
        red: 128,
        green: 83,
        blue: 0
    };
}
