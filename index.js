require("dotenv").config()
const Web3 = require('web3')
const curveAbi = require('./abi/curve.json')
const oracleAbi = require('./abi/oracle.json')
const contractAbi = require('./abi/contract.json')
const BigNumber = require('bignumber.js')
const createCsvWriter = require('csv-writer').createObjectCsvWriter
const fs = require('fs')
const web3 = new Web3(process.env.ARB_RPC_URL)

const contractAddress = process.env.ARB_USDC_ARB_POOL
const chainlink_usdc = process.env.CHAINLINK_USDC_USD_ARB
const usdc_address = process.env.USDC_ADDRESS
const chainlink_arb = process.env.CHAINLINK_ARB_USD_ARB
const arb_address = process.env.ARB_ADDRESS
const treasury_addr = process.env.TREASURY
let tradeData = []
const curveInstance = new web3.eth.Contract(curveAbi, contractAddress)
const arbOracleInstance = new web3.eth.Contract(oracleAbi, chainlink_arb)
const usdcOracleInstance = new web3.eth.Contract(oracleAbi, chainlink_usdc)
const usdcInstance = new web3.eth.Contract(contractAbi, usdc_address)
const arbInstance = new web3.eth.Contract(contractAbi, arb_address)

//get hirtorical swap data for curve pool
curveInstance.getPastEvents('Trade', {
    fromBlock: process.env.BLOCK_NUMBER, //from pool deployed block number
    toBlock: 'latest'
}, async(error, events) => {
    if (error) {
        console.error(error)
    } else {
        await saveSwapData(events)
    }
})

const getOraclePrice = async (oracleInstance, blockNumber) => {
  oracleInstance.defaultBlock = blockNumber;
  const price = await oracleInstance.methods.latestAnswer().call();
  const decimals = await oracleInstance.methods.decimals().call();
  return new BigNumber(price).div(new BigNumber(10).pow(decimals));
}

const saveSwapData = async pastEvents => {
  let totalFee = 0
  pastEvents.forEach(async event => {
    let originDecimals, targetDecimals, originAmount, originUsdAmount, targetAmount,
      targetPrice, targetUsdAmount, feeInUsd, feeInstance, transactionHash
    const blockNumber = event.blockNumber
    
    const arbPrice = await getOraclePrice(arbOracleInstance, blockNumber)
    const usdcPrice = await getOraclePrice(usdcOracleInstance, blockNumber);

    if(event.returnValues.origin == usdc_address) {
      originDecimals = await usdcInstance.methods.decimals().call();
      targetDecimals = await arbInstance.methods.decimals().call();
      originAmount = new BigNumber(event.returnValues.originAmount).div(new BigNumber(10).pow(originDecimals))
      originUsdAmount = originAmount.times(usdcPrice)
      targetAmount = new BigNumber(event.returnValues.targetAmount).div(new BigNumber(10).pow(targetDecimals))
      targetPrice = arbPrice
      targetUsdAmount = targetAmount.times(targetPrice)
      feeInstance = arbInstance
    } else {
      originDecimals = await arbInstance.methods.decimals().call();
      targetDecimals = await usdcInstance.methods.decimals().call();
      originAmount = new BigNumber(event.returnValues.originAmount).div(new BigNumber(10).pow(originDecimals))
      originUsdAmount = originAmount.times(arbPrice)
      targetAmount = new BigNumber(event.returnValues.targetAmount).div(new BigNumber(10).pow(targetDecimals))
      targetPrice = usdcPrice
      targetUsdAmount = targetAmount.times(targetPrice)
      feeInstance = usdcInstance
    }

    await feeInstance.getPastEvents('Transfer', {
      fromBlock: blockNumber,
      toBlock: blockNumber
    }, async(error, events) => {
      if (error) {
          console.error(error)
      } else {
          events.forEach(event => {
            transactionHash = event.transactionHash
            if (event.returnValues.from.toLowerCase() === contractAddress.toLowerCase() && event.returnValues.to.toLowerCase() === treasury_addr.toLowerCase()) {
              feeInUsd = new BigNumber(event.returnValues.value).div(new BigNumber(10).pow(targetDecimals)).times(targetPrice)
            }
          })
      }
    })

    totalFee = new BigNumber(totalFee).plus(feeInUsd)
    let element = {
        blockNumber,
        blockHash: event.blockHash,
        transactionHash,
        trader: event.returnValues.trader,
        origin: event.returnValues.origin,
        target: event.returnValues.target,
        originAmount: originAmount,
        originUsdAmount,
        targetAmount,
        targetUsdAmount,
        feeInUsd,
        arbPrice,
        usdcPrice,
    }
    
    tradeData.push(element)

    tradeData.sort((a, b) => a.blockNumber - b.blockNumber)

    const csvWriter = createCsvWriter({
        path: 'output.csv',
        header: [
          { id: 'blockNumber', title: 'Block Number' },
          { id: 'blockHash', title: 'BlockHash' },
          { id: 'transactionHash', title: 'Transaction Hash' },
          { id: 'trader', title: 'Trader' },
          { id: 'origin', title: 'Origin' },
          { id: 'target', title: 'Target' },
          { id: 'originAmount', title: 'Origin Amount' },
          { id: 'originUsdAmount', title: 'Origin USDAmount' },
          { id: 'targetAmount', title: 'Target Amount' },
          { id: 'targetUsdAmount', title: 'Target USDAmount' },
          { id: 'feeInUsd', title: 'Fee In USD' },
          { id: 'arbPrice', title: 'ARBPrice' },
          { id: 'usdcPrice', title: 'USDCPrice' },
        ],
      })
    csvWriter.writeRecords(tradeData)
      .then(() => {
        console.log('totalFee In USD Sum: ', totalFee.toFixed(6))
      })
      .catch((error) => {
        console.error('Error writing CSV file:', error);
      })
  })
}
