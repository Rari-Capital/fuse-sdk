# Rari Capital: Fuse JavaScript SDK

Calling all DeFi developers: Rari Capital's SDK is now available for easy implementation of our smart contract APIs! Simply install the SDK, instantiate the `Rari` class, and [tap into the Rari Stable Pool via the `Rari.pools.stable` object](docs/pools/stable.md).

## Installation

### Node.js

Install the SDK as a dependency of your project:

```
npm install --save @Rari-Capital/rari-sdk
```

Import the `rari-sdk` package:

```
const Rari = require("@Rari-Capital/rari-sdk");
```

### Browser

Include the prebuilt `dist/rari.window.js` in your HTML to expose the `Rari` class on the `window` object:

```
<script src="dist/rari.window.js">
```

## Instantiation

The `Rari` class is instantiated with a Web3 provider as the sole constructor parameter.

### Node.js

```
var rari = new Rari("http://localhost:8545");
```

### Browser

```
var rari = new Rari(window.ethereum || "http://localhost:8545");
```

## `Rari` Class API

The `Rari` class is not very useful unless instantiated, except for a couple objects:

### SDK web3.js Class: `Rari.Web3`

Access the underlying web3.js class used by the SDK.

### SDK web3.js Class: `Rari.BN`

Access the underlying `BN` class used by the SDK. (Alias for `Rari.Web3.utils.BN`.)

## `Rari` Instance API

The following objects are available on instances of the `Rari` class:

### [Rari Stable Pool: `Rari.pools.stable`](docs/pools/stable.md)

Access wrapper APIs for easy implementation of our smart contracts (as well as the underlying `web3.eth.Contract` objects). See [`docs/pools/stable.md`](docs/pools/stable.md) for API documentation.

### [Rari Yield Pool: `Rari.pools.yield`](docs/pools/yield.md)

Access wrapper APIs for easy implementation of our smart contracts (as well as the underlying `web3.eth.Contract` objects). See [`docs/pools/yield.md`](docs/pools/yield.md) for API documentation.

### [Rari Ethereum Pool: `Rari.pools.ethereum`](docs/pools/ethereum.md)

Access wrapper APIs for easy implementation of our smart contracts (as well as the underlying `web3.eth.Contract` objects). See [`docs/pools/ethereum.md`](docs/pools/ethereum.md) for API documentation.

### ERC20 Token Data: `Rari.getAllTokens([cacheTimeout])`

An async function returning an object containing currency codes mapped to token objects with the following parameters: `name` (string), `symbol` (string), `decimals` (integer `Number`), `address` (string), and `contract` ([a `web3.eth.Contract` instance](https://web3js.readthedocs.io/en/v1.2.11/web3-eth-contract.html)). Optionally accepts a `cacheTimeout` (in seconds) as a parameter.

### SDK web3.js Instance: `Rari.web3`

Access the underlying web3.js instance used by the SDK.

## Examples

### Get Rari Stable Pool APY

```
// Get exact APY (as a BN scaled by 1e18)
try {
    var rspApy = await rari.pools.stable.apy.getCurrentApy();
} catch (error) {
    return console.error(error);
}

// Convert BN to string, parse as float, and divide by 1e18
console.log("Current Rari Stable Pool APY:", parseFloat(rspApy.toString()) / 1e18);
```

### Deposit 1000 DAI to Rari Stable Pool

```
// Get tokens (including DAI)
try {
    var tokens = await Rari.getAllTokens();
} catch (error) {
    return console.error(error);
}

// Convert 1000 DAI to BN (scaled by 1e18 because DAI uses 18 decimal places)
var amount = new Rari.BN(1000).mul((new Rari.BN(10)).pow(new Rari.BN(tokens.DAI.decimals)))

// Deposit 1000 DAI!
try {
    var credited = await rari.pools.stable.deposits.deposit("DAI", amount, { from: "0x0000000000000000000000000000000000000000" });
} catch (error) {
    return console.error(error);
}

// Convert BN to string, parse as float, and divide by 1e18
console.log("USD amount added to account balance:", parseFloat(credited.toString()) / 1e18);
```

## Development

To build the production browser distribution bundle, run `npm run build`. To build the development browser distribution bundle, run `npm run dev`.
