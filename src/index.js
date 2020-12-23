/* eslint-disable */
import Web3 from "web3";

var contracts = require(__dirname + "/contracts.json").contracts;

export default class Fuse {
  static COMPTROLLER_CONTRACT_ADDRESS;
  static CERC20_DELEGATE_CONTRACT_ADDRESS;

  constructor(web3Provider) {
    this.web3 = new Web3(web3Provider);

    this.deployPriceOracle = async function(model, options) {
      if (!model) model = "SimplePriceOracle";
      var priceOracle = new this.web3.eth.Contract(JSON.parse(contracts["contracts/" + model + ".sol:" + model].abi));
      priceOracle = await priceOracle.deploy({ data: "0x" + contracts["contracts/" + model + ".sol:" + model].bin }).send(options);
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
      if (!implementationAddress) {
        var cErc20Delegate = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].abi));
        cErc20Delegate = await cErc20Delegate.deploy({ data: "0x" + contracts["contracts/CErc20Delegate.sol:CErc20Delegate"].bin, arguments: deployArgs }).send(options);
        implementationAddress = cErc20Delegate.options.address;
      }

      var cErc20Delegator = new this.web3.eth.Contract(JSON.parse(contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].abi));
      let deployArgs = [conf.underlying, conf.comptroller, conf.interestRateModel, conf.initialExchangeRateMantissa.toString(), conf.name, conf.symbol, conf.decimals, conf.admin, implementationAddress, "0x0"];
      cErc20Delegator = await cErc20Delegator.deploy({ data: "0x" + contracts["contracts/CErc20Delegator.sol:CErc20Delegator"].bin, arguments: deployArgs }).send(options);

      if (supportMarket) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
        await comptroller.methods._supportMarket(cErc20Delegator.options.address).send(options);
      }

      if (collateralFactor) {
        var comptroller = new this.web3.eth.Contract(JSON.parse(contracts["contracts/Comptroller.sol:Comptroller"].abi), conf.comptroller);
        await comptroller.methods._setCollateralFactor(cErc20Delegator.options.address, collateralFactor).send(options);
      }

      return [cErc20Delegator.options.address, implementationAddress];
    }
  }

  static Web3 = Web3;
  static BN = Web3.utils.BN;
}
