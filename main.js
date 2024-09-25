const fs = require('fs');

const config = {
  explorerBaseUrl: 'https://api.ergoplatform.com/api/v1',
  collectionToken: '09fe0a68151c238bee4ecce065ef29ca1c896fdd64284c0a51e80ce0c5b30b33',
  batchLimit: 100,
  outputFile: 'nft_holders.csv',
  maxRetries: 3,
  retryDelay: 1000
};

async function fetchWithRetry(url, retries = config.maxRetries) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, config.retryDelay));
      return fetchWithRetry(url, retries - 1);
    }
    throw error;
  }
}

async function getBoxesByTokenId(id, limit, offset) {
  const url = `${config.explorerBaseUrl}/boxes/byTokenId/${id}?limit=${limit}&offset=${offset}`;
  return fetchWithRetry(url);
}

async function getBoxUnspentByNFT(id) {
  const url = `${config.explorerBaseUrl}/boxes/unspent/byTokenId/${id}`;
  const data = await fetchWithRetry(url);
  return data.items[0];
}

async function getTxById(id) {
  const url = `${config.explorerBaseUrl}/transactions/${id}`;
  return fetchWithRetry(url);
}

function isNftMint(tx) {
  if (!tx || !tx.inputs || !tx.outputs) {
    console.warn('Invalid transaction data:', tx);
    return null;
  }
  const inputBoxIds = tx.inputs.map(i => i.boxId);
  const outputAssets = tx.outputs.flatMap(o => o.assets?.map(a => a.tokenId) || []);
  const matchingTokenId = outputAssets.find(tokenId => inputBoxIds.includes(tokenId));
  return matchingTokenId || null;
}

async function main() {
  let offset = 0;
  const boxes = [];

  while (true) {
    try {
      const res = await getBoxesByTokenId(config.collectionToken, config.batchLimit, offset);

      if (!res || res.items.length === 0) {
        break;
      }

      const newBoxes = res.items
        .filter(b => b.spentTransactionId && b.spentTransactionId.length === 64)
        .map(b => b.spentTransactionId);

      boxes.push(...newBoxes);

      console.log(`Fetched ${newBoxes.length} new boxes. Total: ${boxes.length}`);

      offset += config.batchLimit;
    } catch (error) {
      console.error('Error fetching boxes:', error);
      break;
    }
  }

  console.log(`Retrieved ${boxes.length} spent collection boxes`);

  const transactions = await Promise.all(
    boxes.map(id => getTxById(id).catch(error => {
      console.error(`Error fetching transaction ${id}:`, error);
      return null;
    }))
  );

  console.log(`Retrieved ${transactions.filter(Boolean).length} transactions`);

  const nftsInCollection = transactions
    .filter(Boolean)
    .map(isNftMint)
    .filter(tokenId => tokenId !== null);

  console.log(`Found ${nftsInCollection.length} mints`);

  const holderMap = new Map();

  for (const nft of nftsInCollection) {
    try {
      const box = await getBoxUnspentByNFT(nft);
      if (box && box.address) {
        holderMap.set(nft, box.address);
      } else {
        console.log(`NFT ${nft} burned or not found!`);
      }
    } catch (error) {
      console.error(`Error processing NFT ${nft}:`, error);
    }
  }

  const csvContent = Array.from(holderMap.entries())
    .map(([nft, address]) => `${nft},${address}`)
    .join('\n');

  fs.writeFileSync(config.outputFile, 'NFT,Address\n' + csvContent);

  console.log(`CSV file "${config.outputFile}" has been created with NFT and Address data.`);
  console.log(`Total NFTs processed: ${nftsInCollection.length}`);
  console.log(`NFTs with valid addresses: ${holderMap.size}`);
}

main().catch(error => console.error('An error occurred:', error));




