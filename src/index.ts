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



interface MiioGateway extends MiioDevice
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

const log = akala.log('domojs:mihome');
var ready = false;
var registered = false;

akala.injectWithName(['$master', '$isModule', '$http', '$worker'], function (master: akala.worker.MasterRegistration, isModule: (m: string) => boolean, http: akala.Http, worker: EventEmitter)
{
    if (isModule('@domojs/mihome'))
    {
        worker.on('ready', function ()
        {
            ready = true;
            log('ready');
        })

        var devices: { [key: string]: MiioDevice } = {};
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

        akala.worker.createClient('devices').then((c) =>
        {
            var serverDevice = device.createServerProxy(c);
            var client = deviceType.createClient(c)({
                status: function (param)
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
                    if (param.body.IP)
                        return miio.device({ address: param.body.IP }).then((device: MiioDevice) =>
                        {
                            devices[param.device.name] = device;
                            if (device.type == 'gateway')
                                param.device.commands = ['addDevice', 'stopAddDevice'];
                            param.device.subdevices = akala.map(device.capabilities, function (capability: string): domojs.devices.IDevice
                            {
                                switch (capability)
                                {
                                    case 'color:rgb':
                                        return { name: 'rgb', commands: ['red', 'green', 'blue'], type: 'mihome' };
                                    case 'brightness':
                                        return { name: 'brightness', commands: ['set', 'off', 'on'], type: 'mihome' };
                                    case 'illuminance':
                                        return { name: 'illuminance', commands: [], type: 'mihome', statusMethod: 'push' }
                                    default:
                                        return null;
                                    case 'temperature':
                                        return { name: capability, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'aqi':
                                        return { name: capability, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'brightness':
                                    case 'illuminance':
                                        return { name: capability, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'pressure':
                                        return { name: capability, commands: [], statusMethod: 'push', type: 'mihome' }
                                    case 'humidity':
                                        return { name: capability, commands: [], statusMethod: 'push', type: 'mihome' }
                                }
                            }).filter((device) => !!device);
                        });
                    if (param.device.name.indexOf('.') > -1)
                    {
                        var device = getMainDevice(param.device.name);
                        device.device.on('propertyChanged', e =>
                        {
                            serverDevice.status({ device: param.device.name, state: e.value, type: 'mihome' });
                        });
                    }
                },
                exec: function (param)
                {
                    if (param.device && param.device)
                    {
                        var device = devices[param.device];
                        if (device)
                            console.log('run command ' + param.command + ' on ' + param.device);
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