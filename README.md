
# node-red-contrib-myskoda

[![NPM version](http://img.shields.io/npm/v/node-red-contrib-myskoda.svg)](https://www.npmjs.com/package/node-red-contrib-myskoda)
[![Downloads](https://img.shields.io/npm/dm/node-red-contrib-myskoda.svg)](https://www.npmjs.com/package/node-red-contrib-myskoda)



## MySkoda nodes for Node-RED

Simple nodes for getting car information from the **MySkoda** platform and sending remote commands to your vehicle.

> **v2.2.0** - Shared credentials via config node (enter email/password once, use in all nodes). Includes complete example flow with all operations.
>
> **v2.0.0** - Complete rewrite using the new MySkoda API (replaces the legacy Skoda Connect / VW Group API that stopped working). All Skoda vehicles supported by the MySkoda app are compatible.

## Requirements

- Node.js >= 16
- A MySkoda account (the same credentials you use in the MySkoda mobile app)
- Your vehicle must be visible and functional in the MySkoda app

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-myskoda
```

## Configuration

1. Add any **myskoda-get** or **myskoda-set** node to your flow
2. In the node config, click the pencil icon next to **Account** to create a new **MySkoda Account** config node
3. Enter your MySkoda email and password once — all nodes sharing the same config will use these credentials

## Usage: myskoda-get node

Select your MySkoda Account. Any input triggers the API call. Output is a JSON object with information for each vehicle in your account.

**Always returned:**
- Vehicle info (model, nickname, connectivity generation)
- Vehicle status (doors, windows, lights, odometer)
- Driving range (fuel level, battery SoC, estimated range)

**Optional (select in node config):**
- Parking position
- Air conditioning status
- Charging information (EV/PHEV)
- Maintenance report

### Example output

```json
{
  "vehicles": [
    {
      "vin": "TMBJXXXXXXXXXXXXXXX",
      "info": { ... },
      "status": { ... },
      "drivingRange": { ... },
      "positions": { ... },
      "airConditioning": { ... },
      "charging": { ... },
      "maintenance": { ... }
    }
  ]
}
```

## Example flow

A complete example flow with all operations is included. Import it via:
**Menu → Import → Examples → node-red-contrib-myskoda → complete-flow**

## Usage: myskoda-set node

Select your MySkoda Account and a command from the dropdown. Each command requires `msg.vin` with the vehicle VIN.

### Available commands

| Command | msg.payload | Other required fields |
|---------|-------------|----------------------|
| Start Air Conditioning | - | - |
| Stop Air Conditioning | - | - |
| Set Target Temperature | number (Celsius, e.g. 21.5) | - |
| Start Window Heating | - | - |
| Stop Window Heating | - | - |
| Start Charging | - | - |
| Stop Charging | - | - |
| Set Charge Limit | number (%, e.g. 80) | - |
| Lock Vehicle | - | msg.spin (S-PIN) |
| Unlock Vehicle | - | msg.spin (S-PIN) |
| Honk and Flash | - | msg.latitude, msg.longitude |
| Flash | - | msg.latitude, msg.longitude |
| Wake Up Vehicle | - | - |

### Example input

```json
{
  "vin": "TMBJXXXXXXXXXXXXXXX",
  "payload": 22
}
```

## Credits

- Thanks to [skodaconnect/myskoda](https://github.com/skodaconnect/myskoda) for reverse-engineering the new MySkoda API
- Thanks to Martin Gris for original inspiration

## Disclaimer

This is an unofficial integration. The MySkoda API is not publicly documented and may change without notice. Use at your own risk.

## Buy me a beer

Find it useful? Please consider buying me or other contributors a beer.

<a href="https://www.buymeacoffee.com/trpkosj" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Beer" style="height: 41px !important;width: 174px !important;box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;-webkit-box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;" ></a>

