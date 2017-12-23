import * as miio from 'miio';
import * as debug from 'debug';
debug.enable('miio.device*');


miio.device({ address: '192.168.67.148', token:'769808189e99b3aea75503bc46bc3954' }).then(function (device)
{
    console.log(device);
});