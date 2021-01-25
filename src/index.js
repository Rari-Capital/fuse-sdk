/* eslint-disable */
import Web3 from "web3";

var fusePoolDirectoryAbi = require(__dirname + "/abi/FusePoolDirectory.json");
var fuseSafeLiquidatorAbi = require(__dirname + "/abi/FuseSafeLiquidator.json");
var contracts = require(__dirname + "/contracts/compound-protocol.json").contracts;
var openOracleContracts = require(__dirname + "/contracts/open-oracle.json").contracts;

export default class Fuse {
  static FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  static FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
  static COMPTROLLER_IMPLEMENTATION_CONTRACT_ADDRESS;
  static CERC20_DELEGATE_CONTRACT_ADDRESS;
  static CETHER_DELEGATE_CONTRACT_ADDRESS;
  static OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS = "0xc629c26dced4277419cde234012f8160a0278a79";

  constructor(web3Provider) {
    this.web3 = new Web3(web3Provider);
    this.contracts = {
      FusePoolDirectory: new this.web3.eth.Contract(fusePoolDirectoryAbi, Fuse.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS),
      FuseSafeLiquidator: new this.web3.eth.Contract(fuseSafeLiquidatorAbi, Fuse.FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS)
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
          priceOracle = await this.deployPriceOracle(priceOracle, { isPublic: false }, options); // TODO: anchorMantissa / anchorPeriod
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
          priceOracle = await this.deployPriceOracle(priceOracle, { isPublic: false }, options); // TODO: anchorMantissa / anchorPeriod
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
          // Deploy ChainlinkPriceOracle
          if (!conf.chainlinkPriceOracle) conf.chainlinkPriceOracle = await this.deployPriceOracle("ChainlinkPriceOracle", {}, options);
          
          // Deploy Uniswap price oracle
          if (!conf.uniswapPriceOracle) conf.uniswapPriceOracle = await this.deployPriceOracle("UniswapView", { isPublic: conf.isPublic }, options);

          // Deploy PreferredPriceOracle
          var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/PreferredPriceOracle.sol:PreferredPriceOracle"].abi));
          priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/PreferredPriceOracle.sol:PreferredPriceOracle"].bin, arguments: [conf.chainlinkPriceOracle, conf.uniswapPriceOracle] }).send(options);

          break;
        case "ChainlinkPriceOracle":
          var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].abi));
          priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].bin }).send(options);
          break;
        case "UniswapAnchoredView":
          const reporter = "0xfCEAdAFab14d46e20144F48824d0C09B1a03F2BC";
          if (!conf || conf.anchorMantissa === undefined || conf.anchorMantissa === null) conf.anchorMantissa = Web3.utils.toBN(1e17); // 1e17 equates to 10% tolerance for source price to be above or below anchor
          if (!conf || conf.anchorPeriod === undefined || conf.anchorPeriod === null) conf.anchorPeriod = 30 * 60;
          var priceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].abi));
          var PriceSource = {
            FIXED_ETH: 0,
            FIXED_USD: 1,
            REPORTER: 2,
            TWAP: 3
          };
          var tokenConfigs = [{ underlying: "0x0000000000000000000000000000000000000000", symbolHash: Web3.utils.soliditySha3("ETH"), baseUnit: Web3.utils.toBN(1e18).toString(), priceSource: PriceSource.REPORTER, fixedPrice: 0, uniswapMarket: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", isUniswapReversed: true }];
          var deployArgs = [Fuse.OPEN_ORACLE_PRICE_DATA_CONTRACT_ADDRESS, reporter, conf.anchorMantissa, conf.anchorPeriod, tokenConfigs];
          priceOracle = await priceOracle.deploy({ data: "0x" + openOracleContracts["contracts/Uniswap/UniswapAnchoredView.sol:UniswapAnchoredView"].bin, arguments: deployArgs }).send(options);
          // TODO: Report first ETH/USD price to UniswapAnchoredView
          break;
        case "UniswapView":
          if (!conf || conf.anchorPeriod === undefined || conf.anchorPeriod === null) conf.anchorPeriod = 30 * 60;
          var priceOracle = new this.web3.eth.Contract(JSON.parse(openOracleContracts["contracts/Uniswap/UniswapView.sol:UniswapView"].abi));
          var deployArgs = [conf.anchorPeriod, conf.tokenConfigs !== undefined ? conf.tokenConfigs : [], conf.isPublic];
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

    this.deployAsset = async function(conf, collateralFactor, reserveFactor, adminFee, options, bypassPriceFeedCheck) {
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
        var [assetAddress, receipt] = await this.deployCToken(conf, true, collateralFactor, reserveFactor, adminFee, options, bypassPriceFeedCheck);
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
    
    this.deployCToken = async function(conf, supportMarket, collateralFactor, reserveFactor, adminFee, options, bypassPriceFeedCheck) {
      return conf.underlying !== undefined && conf.underlying !== null && conf.underlying.length > 0 ? await this.deployCErc20(conf, supportMarket, collateralFactor, reserveFactor, adminFee, Fuse.CERC20_DELEGATE_CONTRACT_ADDRESS ? Fuse.CERC20_DELEGATE_CONTRACT_ADDRESS : null, options, bypassPriceFeedCheck) : [await this.deployCEther(conf, supportMarket, collateralFactor, reserveFactor, adminFee, Fuse.CETHER_DELEGATE_CONTRACT_ADDRESS ? Fuse.CETHER_DELEGATE_CONTRACT_ADDRESS : null, options)];
    };
    
    this.deployCEther = async function(conf, supportMarket, collateralFactor, reserveFactor, adminFee, implementationAddress, options) {
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
      if (reserveFactor) await cEtherDelegator.methods._setReserveFactor(reserveFactor).send(options);
      if (adminFee) await cEtherDelegator.methods._setAdminFee(adminFee).send(options);

      // Return cToken proxy and implementation contract addresses
      return [cEtherDelegator.options.address, implementationAddress];
    };
    
    this.deployCErc20 = async function(conf, supportMarket, collateralFactor, reserveFactor, adminFee, implementationAddress, options, bypassPriceFeedCheck) {
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
            chainlinkPriceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle"].abi), chainlinkPriceOracle);
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
            await uniswapOrUniswapAnchoredView.methods.getTokenConfigByUnderlying(conf.underlying).call();
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

            if (conf.underlying == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
              // WETH
              await uniswapOrUniswapAnchoredView.methods.add([{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: PriceSource.FIXED_ETH, fixedPrice: Web3.utils.toBN(1e18).toString(), uniswapMarket: "0x0000000000000000000000000000000000000000", isUniswapReversed: false }]).send({ ...options });
            } else {
              // Ask about fixed prices if UniswapAnchoredView or if UniswapView is not public; otherwise, prompt for Uniswap V2 pair
              if (isUniswapAnchoredView || !(await uniswapOrUniswapAnchoredView.methods.isPublic().call())) {
                // Check for fixed ETH
                var fixedEth = confirm("Should the price of this token be fixed to 1 ETH?");

                if (fixedEth) {
                  await uniswapOrUniswapAnchoredView.methods.add([{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: PriceSource.FIXED_ETH, fixedPrice: Web3.utils.toBN(1e18).toString(), uniswapMarket: "0x0000000000000000000000000000000000000000", isUniswapReversed: false }]).send({ ...options });
                } else {
                  // Check for fixed USD
                  var fixedUsd = confirm("Should the price of this token be fixed to 1 USD?" + (isUniswapAnchoredView ? "" : "If so, please note that you will need to run postPrices on your UniswapView for USDC instead of " + underlyingSymbol + " (as technically, the " + underlyingSymbol + " price would be fixed to 1 USDC)."));

                  if (fixedUsd) {
                    var tokenConfigs = [{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: PriceSource.FIXED_USD, fixedPrice: Web3.utils.toBN(1e6).toString(), uniswapMarket: "0x0000000000000000000000000000000000000000", isUniswapReversed: false }];

                    // UniswapView only: add USDC token config if not present so price oracle can convert from USD to ETH
                    if (!isUniswapAnchoredView) {
                      try {
                        await uniswapOrUniswapAnchoredView.methods.getTokenConfigByUnderlying("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48").call();
                      } catch (error) {
                        tokenConfigs.push({ underlying: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbolHash: Web3.utils.soliditySha3("USDC"), baseUnit: Web3.utils.toBN(1e6).toString(), priceSource: PriceSource.TWAP, fixedPrice: 0, uniswapMarket: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", isUniswapReversed: false });
                      }
                    }

                    // Add token config(s)
                    await uniswapOrUniswapAnchoredView.methods.add(tokenConfigs).send({ ...options });

                    // UniswapView only: post USDC price
                    if (!isUniswapAnchoredView) await uniswapOrUniswapAnchoredView.methods.postPrices(["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]).send({ ...options });
                  } else await promptForUniswapV2Pair(); // Prompt for Uniswap V2 pair
                }
              } else await promptForUniswapV2Pair(); // Prompt for Uniswap V2 pair

              async function promptForUniswapV2Pair() {
                var uniswapV2Pair = prompt("Please enter the underlying token's ETH-based Uniswap V2 pair address:");
        
                if (uniswapV2Pair.length > 0) {
                  var isNotReversed = confirm("Press OK if the Uniswap V2 pair is " + underlyingSymbol + "/ETH? If it is reversed (ETH/" + underlyingSymbol + "), press Cancel.");
                  await uniswapOrUniswapAnchoredView.methods.add([{ underlying: conf.underlying, symbolHash: Web3.utils.soliditySha3(underlyingSymbol), baseUnit: Web3.utils.toBN(10).pow(Web3.utils.toBN(underlyingDecimals)).toString(), priceSource: isUniswapAnchoredView ? PriceSource.REPORTER : PriceSource.TWAP, fixedPrice: 0, uniswapMarket: uniswapV2Pair, isUniswapReversed: !isNotReversed }]).send({ ...options });
                  if (!isUniswapAnchoredView) await uniswapOrUniswapAnchoredView.methods.postPrices([ conf.underlying ]).send({ ...options });
                  // TODO: Post first price to UniswapAnchoredView
                } else throw isUniswapAnchoredView ? "Reported prices must have a Uniswap V2 pair as an anchor!" : "Non-fixed prices must have a Uniswap V2 pair from which to source prices!";
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
      if (reserveFactor) await cErc20Delegator.methods._setReserveFactor(reserveFactor).send(options);
      if (adminFee) await cErc20Delegator.methods._setAdminFee(adminFee).send(options);

      // Return cToken proxy and implementation contract addresses
      return [cErc20Delegator.options.address, implementationAddress];
    };
  }

  static Web3 = Web3;
  static BN = Web3.utils.BN;
}
