/* eslint-disable */
import Web3 from "web3";

var fusePoolDirectoryAbi = require(__dirname + "/abi/FusePoolDirectory.json");
var contracts = require(__dirname + "/contracts/compound-protocol.json").contracts;
var openOracleContracts = require(__dirname + "/contracts/open-oracle.json").contracts;

export default class Fuse {
  static FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  static COMPTROLLER_IMPLEMENTATION_CONTRACT_ADDRESS;
  static CERC20_DELEGATE_CONTRACT_ADDRESS;
  static CETHER_DELEGATE_CONTRACT_ADDRESS;
  static OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS = "0xc629c26dced4277419cde234012f8160a0278a79";

  constructor(web3Provider) {
    this.web3 = new Web3(web3Provider);
    this.contracts = {
      FusePoolDirectory: new this.web3.eth.Contract(fusePoolDirectoryAbi, Fuse.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS)
    };

    this.getCreate2Address = function(creatorAddress, salt, byteCode) {
      return `0x${this.web3.utils.sha3(`0x${[
        'ff',
        creatorAddress,
        this.web3.utils.soliditySha3(salt),
        this.web3.utils.sha3(byteCode)
      ].map(x => x.replace(/0x/, ''))
      .join('')}`).slice(-40)}`.toLowerCase()
    }

    this.deployPool = async function(poolName, isPrivate, closeFactor, maxAssets, liquidationIncentive, priceOracle, options) {
      // Deploy new price oracle via SDK if requested
      if (["SimplePriceOracle", "PreferredPriceOracle", "ChainlinkPriceOracle", "UniswapAnchoredView", "UniswapView"].indexOf(priceOracle) >= 0) {
        try {
          priceOracle = await this.deployPriceOracle(priceOracle, { maxTokens: maxAssets }, options); // TODO: anchorMantissa / anchorPeriod
        } catch (error) {
          throw "Deployment of price oracle failed: " + (error.message ? error.message : error);
        }
      }
      
      // Deploy Comptroller implementation if necessary
      var implementationAddress = Fuse.COMPTROLLER_IMPLEMENTATION_CONTRACT_ADDRESS;

      if (!implementationAddress) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi));
        comptroller = await comptroller.deploy({ data: "0x" + contracts["contracts/Comptroller.sol:Comptroller"].bin }).send(options);
        implementationAddress = comptroller.options.address;
      }

      // Register new pool with FusePoolDirectory
      try {
        var receipt = await this.contracts.FusePoolDirectory.methods.deployPool(poolName, implementationAddress, isPrivate, closeFactor, maxAssets, liquidationIncentive, priceOracle).send(options);
      } catch (error) {
        throw "Deployment and registration of new Fuse pool failed: " + (error.message ? error.message : error);
      }

      // Compute Unitroller address
      var poolAddress = this.getCreate2Address(Fuse.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS, poolName, "0x" + contracts["contracts/Unitroller.sol:Unitroller"].bin)
      var unitroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Unitroller.sol:Unitroller"].abi), poolAddress);

      // Accept admin status via Unitroller
      try {
        await unitroller.methods._acceptAdmin().send(options);
      } catch (error) {
        throw "Accepting admin status failed: " + (error.message ? error.message : error);
      }

      return [poolAddress, receipt];
    }

    this._deployPool = async function(poolName, isPrivate, closeFactor, maxAssets, liquidationIncentive, priceOracle, options) {
      // Deploy new price oracle via SDK if requested
      if (["SimplePriceOracle", "PreferredPriceOracle", "ChainlinkPriceOracle", "UniswapAnchoredView", "UniswapView"].indexOf(priceOracle) >= 0) {
        try {
          priceOracle = await this.deployPriceOracle(priceOracle, { maxTokens: maxAssets }, options); // TODO: anchorMantissa / anchorPeriod
        } catch (error) {
          throw "Deployment of price oracle failed: " + (error.message ? error.message : error);
        }
      }

      // Deploy new pool via SDK
      try {
        var [poolAddress, receipt] = await this.deployComptroller(closeFactor, maxAssets, liquidationIncentive, priceOracle, null, options);
      } catch (error) {
        throw "Deployment of Comptroller failed: " + (error.message ? error.message : error);
      }

      // Register new pool with FusePoolDirectory
      try {
        await this.contracts.FusePoolDirectory.methods.registerPool(poolName, poolAddress, isPrivate).send(options);
      } catch (error) {
        throw "Registration of new Fuse pool failed: " + (error.message ? error.message : error);
      }

      return [poolAddress, receipt];
    }

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
          var PriceSource = {
            FIXED_ETH: 0,
            FIXED_USD: 1,
            REPORTER: 2,
            TWAP: 3
          };
          var tokenConfigs = [{ underlying: "0x0000000000000000000000000000000000000000", symbolHash: Web3.utils.soliditySha3("ETH"), baseUnit: Web3.utils.toBN(1e18).toString(), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", isUniswapReversed: true }];
          var deployArgs = [Fuse.OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS, reporter, conf.anchorMantissa, conf.anchorPeriod, tokenConfigs, conf.maxTokens];
          priceOracle = await priceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].bin, arguments: deployArgs }).send(options);
          break;
        case "UniswapView":
          if (!conf || conf.anchorMantissa === undefined || conf.anchorMantissa === null) conf.anchorPeriod = 30 * 60;
          var priceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi));
          var PriceSource = {
            FIXED_ETH: 0,
            FIXED_USD: 1,
            REPORTER: 2,
            TWAP: 3
          };
          var tokenConfigs = [{ underlying: "0x0000000000000000000000000000000000000000", symbolHash: Web3.utils.soliditySha3("ETH"), baseUnit: Web3.utils.toBN(1e18).toString(), priceSource: PriceSource.TWAP, fixedPrice: 0, uniswapMarket: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", isUniswapReversed: true }];
          var deployArgs = [conf.anchorPeriod, tokenConfigs, conf.maxTokens];
          priceOracle = await priceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].bin, arguments: deployArgs }).send(options);
          break;
        default:
          var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
          priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin }).send(options);
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

    this.deployAsset = async function(conf, collateralFactor, options, bypassPriceFeedCheck) {
      // Deploy new interest rate model via SDK if requested
      if (["WhitePaperInterestRateModel", "JumpRateModel", "DAIInterestRateModelV2"].indexOf(conf.interestRateModel) >= 0) {
        try {
          conf.interestRateModel = await this.deployInterestRateModel(conf.interestRateModel, options); // TODO: anchorMantissa
        } catch (error) {
          throw "Deployment of interest rate model failed: " + (error.message ? error.message : error);
        }
      }

      // Deploy new asset to existing pool via SDK
      try {
        var [assetAddress, receipt] = await this.deployCToken(conf, true, collateralFactor, options, bypassPriceFeedCheck);
      } catch (error) {
        throw "Deployment of asset to Fuse pool failed: " + (error.message ? error.message : error);
      }

      return [assetAddress, receipt];
    }

    this.deployInterestRateModel = async function(model, options) {
      if (!model) model = "JumpRateModel";
      var interestRateModel = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
      interestRateModel = await interestRateModel.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin }).send(options);
      return interestRateModel.options.address;
    };
    
    this.deployCToken = async function(conf, supportMarket, collateralFactor, options, bypassPriceFeedCheck) {
      return conf.underlying !== undefined && conf.underlying !== null && conf.underlying.length > 0 ? await this.deployCErc20(conf, supportMarket, collateralFactor, Fuse.CERC20_DELEGATE_CONTRACT_ADDRESS ? Fuse.CERC20_DELEGATE_CONTRACT_ADDRESS : null, options, bypassPriceFeedCheck) : [await this.deployCEther(conf, supportMarket, collateralFactor, Fuse.CETHER_DELEGATE_CONTRACT_ADDRESS ? Fuse.CETHER_DELEGATE_CONTRACT_ADDRESS : null, options)];
    };
    
    this.deployCEther = async function(conf, supportMarket, collateralFactor, implementationAddress, options) {
      // Deploy CEtherDelegate implementation contract if necessary
      if (!implementationAddress) {
        var cEtherDelegate = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CEtherDelegate.sol:CEtherDelegate"].abi));
        cEtherDelegate = await cEtherDelegate.deploy({ data: "0x" + contracts["contracts/CEtherDelegate.sol:CEtherDelegate"].bin }).send(options);
        implementationAddress = cEtherDelegate.options.address;
      }

      // Deploy CEtherDelegator proxy contract if necessary
      var cEtherDelegator = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CEtherDelegator.sol:CEtherDelegator"].abi));
      let deployArgs = [conf.comptroller, conf.interestRateModel, conf.initialExchangeRateMantissa.toString(), conf.name, conf.symbol, conf.decimals, conf.admin, implementationAddress, "0x0"];
      cEtherDelegator = await cEtherDelegator.deploy({ data: "0x" + contracts["contracts/CEtherDelegator.sol:CEtherDelegator"].bin, arguments: deployArgs }).send(options);

      // Register new asset with Comptroller
      var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
      if (supportMarket) await comptroller.methods._supportMarket(cEtherDelegator.options.address).send(options);
      if (collateralFactor) await comptroller.methods._setCollateralFactor(cEtherDelegator.options.address, collateralFactor).send(options);

      // Return cToken proxy and implementation contract addresses
      return [cEtherDelegator.options.address, implementationAddress];
    };
    
    this.deployCErc20 = async function(conf, supportMarket, collateralFactor, implementationAddress, options, bypassPriceFeedCheck) {
      // Get Comptroller
      var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);

      // Check for price feed assuming !bypassPriceFeedCheck
      if (!bypassPriceFeedCheck) {
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
                throw "Underlying token price not available via ChainlinkPriceOracle, and no UniswapAnchoredView or UniswapView was found.";
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
                  throw "Underlying token price not available via ChainlinkPriceOracle, and no UniswapAnchoredView or UniswapView was found.";
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
            var underlyingDecimals = await underlyingToken.methods.decimals().call();

            const PriceSource = {
              FIXED_ETH: 0,
              FIXED_USD: 1,
              REPORTER: 2,
              TWAP: 3
            };

            var fixedUsd = confirm("Should the price of this token be fixed to 1 USD?");

            if (fixedUsd) {
              await uniswapOrUniswapAnchoredView.methods.add([{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: PriceSource.FIXED_USD, fixedPrice: Web3.utils.toBN(1e6).toString(), uniswapMarket: "0x0000000000000000000000000000000000000000", isUniswapReversed: false }]).send(options);
            } else {
              var uniswapV2Pair = prompt("Please enter the underlying token's ETH-based Uniswap V2 pair address (if available):");
      
              if (uniswapV2Pair.length > 0) {
                var isNotReversed = confirm("Press OK if the Uniswap V2 pair is " + underlyingSymbol + "/ETH? If it is reversed (ETH/" + underlyingSymbol + "), press Cancel.");
                await uniswapOrUniswapAnchoredView.methods.add([{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: isUniswapAnchoredView ? PriceSource.REPORTER : PriceSource.TWAP, fixedPrice: 0, uniswapMarket: uniswapV2Pair, isUniswapReversed: !isNotReversed }]).send(options);
              }
            }
          }
        }
      }

      // Deploy CErc20Delegate implementation contract if necessary
      if (!implementationAddress) {
        var cErc20Delegate = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].abi));
        cErc20Delegate = await cErc20Delegate.deploy({ data: "0x" + contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].bin }).send(options);
        implementationAddress = cErc20Delegate.options.address;
      }

      // Deploy CErc20Delegator proxy contract if necessary
      var cErc20Delegator = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].abi));
      let deployArgs = [conf.underlying, conf.comptroller, conf.interestRateModel, conf.initialExchangeRateMantissa.toString(), conf.name, conf.symbol, conf.decimals, conf.admin, implementationAddress, "0x0"];
      cErc20Delegator = await cErc20Delegator.deploy({ data: "0x" + contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].bin, arguments: deployArgs }).send(options);

      // Register new asset with Comptroller
      if (supportMarket) await comptroller.methods._supportMarket(cErc20Delegator.options.address).send(options);
      if (collateralFactor) await comptroller.methods._setCollateralFactor(cErc20Delegator.options.address, collateralFactor).send(options);

      // Return cToken proxy and implementation contract addresses
      return [cErc20Delegator.options.address, implementationAddress];
    };
  }

  static Web3 = Web3;
  static BN = Web3.utils.BN;
}
