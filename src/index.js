/* eslint-disable */
import Web3 from "web3";

var contracts = require(__dirname + "/contracts/compound-protocol.json").contracts;
var openOracleContracts = require(__dirname + "/contracts/open-oracle.json").contracts;

export default class Fuse {
  static COMPTROLLER_CONTRACT_ADDRESS;
  static CERC20_DELEGATE_CONTRACT_ADDRESS;
  static OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS = "0xc629c26dced4277419cde234012f8160a0278a79";

  constructor(web3Provider) {
    this.web3 = new Web3(web3Provider);

    this.deployPriceOracle = async function(model, conf, options) {
      if (!model) model = "PreferredPriceOracle";

      switch (model) {
        case "PreferredPriceOracle":
          var chainlinkPriceOracle = conf.chainlinkPriceOracle;

          if (!chainlinkPriceOracle) {
            var chainlinkPriceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].abi));
            chainlinkPriceOracle = await chainlinkPriceOracle.deploy({ data: "0x" + contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].bin }).send(options);
            chainlinkPriceOracle = chainlinkPriceOracle.options.address;
          }
          
          if (!uniswapPriceOracle) {
            var uniswapPriceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi));
            uniswapPriceOracle = await uniswapPriceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].bin }).send(options);
            uniswapPriceOracle = uniswapPriceOracle.options.address;
          }

          var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
          priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin, arguments: [chainlinkPriceOracle, uniswapPriceOracle] }).send(options);

          break;
        case "ChainlinkPriceOracle":
          var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
          priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin }).send(options);
          break;
        case "UniswapAnchoredView":
          const reporter = "0xfCEAdAFab14d46e20144F48824d0C09B1a03F2BC";
          if (!conf || conf.anchorMantissa === undefined || conf.anchorMantissa === null) conf.anchorMantissa = Web3.utils.toBN(1e17); // 1e17 equates to 10% tolerance for source price to be above or below anchor
          if (!conf || conf.anchorMantissa === undefined || conf.anchorMantissa === null) conf.anchorPeriod = 30 * 60;
          var priceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].abi));
          var deployArgs = [Fuse.OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS, reporter, conf.anchorMantissa, conf.anchorPeriod, [], conf.maxTokens];
          priceOracle = await priceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].bin, arguments: deployArgs }).send(options);
          break;
        case "UniswapView":
          if (!conf || conf.anchorMantissa === undefined || conf.anchorMantissa === null) conf.anchorPeriod = 30 * 60;
          var priceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi));
          var deployArgs = [conf.anchorPeriod, [], conf.maxTokens];
          priceOracle = await priceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].bin, arguments: deployArgs }).send(options);
          break;
      }
      
      return priceOracle.options.address;
    };

    this.deployComptroller = async function(closeFactor, maxAssets, liquidationIncentive, priceOracle, implementationAddress, options) {
      if (!implementationAddress) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi));
        comptroller = await comptroller.deploy({ data: "0x" + contracts["contracts/Comptroller.sol:Comptroller"].bin }).send(options);
        implementationAddress = comptroller.options.address;
      }

      var unitroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Unitroller.sol:Unitroller"].abi));
      unitroller = await unitroller.deploy({ data: "0x" + contracts["contracts/Unitroller.sol:Unitroller"].bin }).send(options);
      await unitroller.methods._setPendingImplementation(comptroller.options.address).send(options);
      await comptroller.methods._become(unitroller.options.address).send(options);

      comptroller.options.address = unitroller.options.address;
      if (closeFactor) await comptroller.methods._setCloseFactor(closeFactor).send(options);
      if (maxAssets) await comptroller.methods._setMaxAssets(maxAssets).send(options);
      if (liquidationIncentive) await comptroller.methods._setLiquidationIncentive(liquidationIncentive).send(options);
      if (priceOracle) await comptroller.methods._setPriceOracle(priceOracle).send(options);

      return [unitroller.options.address, implementationAddress];
    };

    this.deployInterestRateModel = async function(model, options) {
      if (!model) model = "WhitePaperInterestModel";
      var interestRateModel = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
      interestRateModel = await interestRateModel.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin }).send(options);
      return interestRateModel.options.address;
    };
    
    this.deployCToken = async function(conf, supportMarket, collateralFactor, implementationAddress, options) {
      return conf.underlying !== undefined && conf.underlying !== null && conf.underlying.length > 0 ? await this.deployCErc20(conf, supportMarket, collateralFactor, implementationAddress, options) : [await this.deployCEther(conf, supportMarket, collateralFactor, options)];
    };
    
    this.deployCEther = async function(conf, supportMarket, collateralFactor, options) {
      var cEther = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CEther.sol:CEther"].abi));
      let deployArgs = [conf.comptroller, conf.interestRateModel, conf.initialExchangeRateMantissa.toString(), conf.name, conf.symbol, conf.decimals, conf.admin];
      cEther = await cEther.deploy({ data: "0x" + contracts["contracts/CEther.sol:CEther"].bin, arguments: deployArgs }).send(options);

      if (supportMarket) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
        await comptroller.methods._supportMarket(cEther.options.address).send(options);
      }

      if (collateralFactor) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
        await comptroller.methods._setCollateralFactor(cEther.options.address, collateralFactor).send(options);
      }

      return cEther.options.address;
    };
    
    this.deployCErc20 = async function(conf, supportMarket, collateralFactor, implementationAddress, options) {
      if (!implementationAddress) {
        var cErc20Delegate = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].abi));
        cErc20Delegate = await cErc20Delegate.deploy({ data: "0x" + contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].bin, arguments: deployArgs }).send(options);
        implementationAddress = cErc20Delegate.options.address;
      }

      var cErc20Delegator = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].abi));
      let deployArgs = [conf.underlying, conf.comptroller, conf.interestRateModel, conf.initialExchangeRateMantissa.toString(), conf.name, conf.symbol, conf.decimals, conf.admin, implementationAddress, "0x0"];
      cErc20Delegator = await cErc20Delegator.deploy({ data: "0x" + contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].bin, arguments: deployArgs }).send(options);

      var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
      if (supportMarket) await comptroller.methods._supportMarket(cErc20Delegator.options.address).send(options);
      if (collateralFactor) await comptroller.methods._setCollateralFactor(cErc20Delegator.options.address, collateralFactor).send(options);

      // Check for ChainlinkPriceOracle with a corresponding feed
      var priceOracle = await comptroller.methods.oracle().call();
      var chainlinkPriceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].abi), priceOracle);

      try {
        var chainlinkPriceFeed = await chainlinkPriceOracle.methods.priceFeeds(conf.underlying).call();
      } catch { }

      if (chainlinkPriceFeed === undefined || Web3.utils.toBN(chainlinkPriceFeed).isZero()) {
        // Check for PreferredPriceOracle with underlying ChainlinkPriceOracle with a corresponding feed
        var preferredPriceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/PreferredPriceOracle.sol:PreferredPriceOracle"].abi), priceOracle);

        try {
          var chainlinkPriceOracle = await preferredPriceOracle.methods.chainlinkOracle().call();
          chainlinkPriceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].abi), chainlinkPriceOracle);
          var chainlinkPriceFeed = await chainlinkPriceOracle.methods.priceFeeds(conf.underlying).call();
        } catch { }
      }
      
      if (chainlinkPriceFeed === undefined || Web3.utils.toBN(chainlinkPriceFeed).isZero()) {
        // Check if we can get a UniswapAnchoredView
        var isUniswapAnchoredView = false;

        try {
          var uniswapOrUniswapAnchoredView = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].abi), priceOracle);
          await uniswapOrUniswapAnchoredView.methods.IS_UNISWAP_ANCHORED_VIEW().call();
          isUniswapAnchoredView = true;
        } catch {
          try {
            var uniswapOrUniswapAnchoredView = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi), priceOracle);
            await uniswapOrUniswapAnchoredView.methods.IS_UNISWAP_VIEW().call();
          } catch {
            // Check for PreferredPriceOracle with underlying UniswapAnchoredView
            var preferredPriceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/PreferredPriceOracle.sol:PreferredPriceOracle"].abi), priceOracle);

            try {
              var uniswapOrUniswapAnchoredView = await preferredPriceOracle.methods.secondaryOracle().call();
            } catch {
              throw "Underlying token price not available via ChainlinkPriceConsumer, and no UniswapAnchoredView or UniswapView was found.";
            }

            try {
              uniswapOrUniswapAnchoredView = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].abi), uniswapOrUniswapAnchoredView);
              await uniswapOrUniswapAnchoredView.methods.IS_UNISWAP_ANCHORED_VIEW().call();
              isUniswapAnchoredView = true;
            } catch {
              try {
                uniswapOrUniswapAnchoredView = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi), uniswapOrUniswapAnchoredView);
                await uniswapOrUniswapAnchoredView.methods.IS_UNISWAP_VIEW().call();
              } catch {
                throw "Underlying token price not available via ChainlinkPriceConsumer, and no UniswapAnchoredView or UniswapView was found.";
              }
            }
          }
        }

        // Check if the token already exists
        try {
          await uniswapOrUniswapAnchoredView.getTokenConfigByUnderlying(conf.underlying).call();
        } catch {
          // If not, add it!
          var underlyingToken = new this.web3.eth.Contract(JSON.parse(contracts["contracts/EIP20Interface.sol:EIP20Interface"].abi), conf.underlying);
          var underlyingSymbol = await underlyingToken.methods.symbol().call();

          const PriceSource = {
            FIXED_ETH: 0,
            FIXED_USD: 1,
            REPORTER: 2,
            TWAP: 3
          };

          var fixedUsd = confirm("Should the price of this token be fixed to 1 USD?");

          if (fixedUsd) {
            await uniswapOrUniswapAnchoredView.methods.add({ underlying: conf.underlying, symbolHash: keccak256(underlyingSymbol), baseUnit: Web3.utils.toBN(1e18), priceSource: PriceSource.FIXED_USD, fixedPrice: Web3.utils.toBN(1e18), uniswapMarket: "0x0000000000000000000000000000000000000000", isUniswapReversed: false }).send(options);
          } else {
            var uniswapV2Pair = prompt("Please enter the underlying token's ETH-based Uniswap V2 pair address (if available):");
    
            if (uniswapV2Pair.length > 0) {
              var isNotReversed = confirm("Press OK if the Uniswap V2 pair is " + underlyingSymbol + "/ETH? If it is reversed (ETH/" + underlyingSymbol + "), press Cancel.");
              await uniswapOrUniswapAnchoredView.methods.add({ underlying: conf.underlying, symbolHash: keccak256(underlyingSymbol), baseUnit: Web3.utils.toBN(1e18), priceSource: isUniswapAnchoredView ? PriceSource.REPORTER : PriceReporter.TWAP, fixedPrice: 0, uniswapMarket: uniswapV2Pair, isUniswapReversed: !isNotReversed }).send(options);
            }
          }
        }
      }

      return [cErc20Delegator.options.address, implementationAddress];
    };
  }

  static Web3 = Web3;
  static BN = Web3.utils.BN;
}
