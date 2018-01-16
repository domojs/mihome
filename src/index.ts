import * as akala from '@akala/server';
import { meta, Service } from '@domojs/service-discovery';
import { devices, device, deviceType } from '@domojs/devices';
import * as miio from 'miio';
import { EventEmitter } from 'events';

interface MiioDevice
{
    id: string;
    type: 'power-switch' | 'power-strip' | 'power-plug' | 'power-outlet' | 'controller' | 'gateway' | 'air-purifier' | 'humidifier' | 'vacuum' | 'light' | 'sensor';
    capabilities: ('temperature' | 'humidity' | 'aqi' | 'color:rgb' | 'illuminance' | 'pressure' | 'power' | 'brightness')[];
    on(event: 'propertyChanged', handler: (e: { value: any }) => void);
}

interface BrightnessCapability
{
    readonly brightness: number;
    setBrightness(value: number);
}

interface RGBCapability
{
    readonly rgb: { red: number, green: number, blue: number };
    setRGB(value: { red: number, green: number, blue: number });
}

interface MiioGateway extends MiioDevice, BrightnessCapability, RGBCapability
{
    type: 'gateway';
    devices: MiioDevice[];
    addDevice();
    stopAddDevice();
    removeDevice(id: string);
    on(event: 'deviceAvailable', handler: (MiioDevice) => void);
    on(event: 'deviceUnavailable', handler: (MiioDevice) => void);
    on(event: 'propertyChanged', handler: (e: { value: any }) => void);
}

interface MiioSensor extends MiioDevice
{
    type: 'sensor';
    devices: MiioDevice[];
    temperature?: number;
    humidity?: number;
    aqi?: number;
    illumination?: number;
    pressure?: number;
}

type MiioDevices = MiioGateway | MiioSensor;

const log = akala.log('domojs:mihome');
var ready = false;
var registered = false;



akala.injectWithName(['$master', '$isModule', '$http', '$worker', '$router'], function (master: akala.worker.MasterRegistration, isModule: (m: string) => boolean, http: akala.Http, worker: EventEmitter, router: akala.worker.Router)
{
    if (isModule('@domojs/mihome'))
    {
        worker.on('ready', function ()
        {
            ready = true;
            log('ready');
        });

        var devices: { [key: string]: MiioDevices } = {};
        function getMainDevice(name)
        {
            var indexOfDot = name.indexOf('.');
            if (indexOfDot > 0)
                var mainDevice = name.substr(0, indexOfDot);
            else
                var mainDevice = name;

            return {
                device: devices[mainDevice],
                capability: indexOfDot > 0 ? name.substring(indexOfDot + 1) : null
            };
        }

        router.get('/api/devices', akala.command([], function ()
        {
            return devices;
        }));

        akala.worker.createClient('devices').then((c) =>
        {
            var serverDevice = device.createServerProxy(c);
            var client = deviceType.createClient(c)({
                getStatus: function (param)
                {
                    var device = getMainDevice(param.device);
                    switch (device.capability)
                    {
                        case 'temperature':
                        case 'aqi':
                        case 'brightness':
                        case 'pressure':
                        case 'humidity':
                        case 'illuminance':
                            return device.device[device.capability];
                        case 'rgb':
                            return device.device['rgb'];
                    }
                },
                save: function (param)
                {
                    if (param.body && param.body.IP)
                        return miio.device({ address: param.body.IP, token: param.body.token }).then((device: MiioDevices) =>
                        {
                            devices[param.device.name] = device;

                            if (device.type == 'gateway')
                                param.device.commands = ['addDevice', 'stopAddDevice'];
                            param.device.subdevices = akala.map(device.capabilities, function (capability: string): domojs.devices.IDevice
                            {
                                switch (capability)
                                {
                                    case 'color:rgb':
                                        return {
                                            name: 'rgb',
                                            category: param.device.category,
                                            commands: {
                                                red: { type: 'range', min: 1, max: 255, value: (device as RGBCapability).rgb.red },
                                                green: { type: 'range', min: 1, max: 255, value: (device as RGBCapability).rgb.green },
                                                blue: { type: 'range', min: 1, max: 255, value: (device as RGBCapability).rgb.blue }
                                            },
                                            type: 'mihome'
                                        };
                                    case 'brightness':
                                        return { name: 'brightness', category: param.device.category, commands: { off: 'off', set: { type: 'range', min: 1, max: 255, value: (device as BrightnessCapability).brightness } }, type: 'mihome' };
                                    case 'illuminance':
                                        return { name: 'illuminance', category: param.device.category, commands: [], type: 'mihome', statusMethod: 'push' }
                                    default:
                                        return null;
                                    case 'temperature':
                                        return { name: capability, category: param.device.category, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'aqi':
                                        return { name: capability, category: param.device.category, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'brightness':
                                    case 'illuminance':
                                        return { name: capability, category: param.device.category, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'pressure':
                                        return { name: capability, category: param.device.category, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'humidity':
                                        return { name: capability, category: param.device.category, commands: [], statusMethod: 'push', type: 'mihome' }
                                }
                            }).filter((device) => !!device);

                            return param.device;
                        });
                    if (param.device.name.indexOf('.') > -1)
                    {
                        var device = getMainDevice(param.device.name);
                        device.device.on('propertyChanged', e =>
                        {
                            client.$proxy().pushStatus({ device: param.device.name, state: e.value });
                        });
                    }
                    return param.device;
                },
                exec: function (param)
                {
                    if (param.device)
                    {
                        var device = getMainDevice(param.device);

                        if (device)
                        {
                            console.log('run command ' + param.command + '(' + param.value + ') on ' + param.device);
                            switch (device.capability)
                            {
                                case 'brightness':
                                    switch (param.command)
                                    {
                                        case 'set':
                                            (device.device as BrightnessCapability).setBrightness(Number(param.value));
                                            break;
                                        case 'off':
                                            (device.device as BrightnessCapability).setBrightness(0);
                                            break;
                                    }
                                    break;
                                case 'rgb':
                                    var rgbDevice = (device.device as RGBCapability);
                                    
                                    switch (param.command)
                                    {
                                        case 'red':
                                            (device.device as RGBCapability).setRGB({ red: Number(param.value), green: rgbDevice.rgb.green, blue: rgbDevice.rgb.blue });
                                            break;
                                        case 'green':
                                            (device.device as RGBCapability).setRGB({ green: Number(param.value), red: rgbDevice.rgb.red, blue: rgbDevice.rgb.blue });
                                            break;
                                        case 'blue':
                                            (device.device as RGBCapability).setRGB({ blue: Number(param.value), green: rgbDevice.rgb.green, red: rgbDevice.rgb.red });
                                            break;
                                    }
                                    break;
                            }
                        }
                    }
                }
            });
            var server = client.$proxy();
            worker.on('ready', function ()
            {
                log('registering');
                if (!registered)
                    server.register({ name: 'mihome', commandMode: 'dynamic', view: '@domojs/mihome/device.html' });
                registered = true;
            })
        });
    }
})();