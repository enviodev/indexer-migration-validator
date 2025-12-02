// Endpoint configuration
export const SUBGRAPH_URL = 'https://g.flayerlabs.xyz/flaunch/base-mainnet';
export const HYPERINDEX_URL = 'https://moose-code-d7ad4a3.dedicated.hyperindex.xyz/v1/graphql';

// Comparison settings
export const DEFAULT_SAMPLE_SIZE = 50;
export const DEFAULT_BATCH_SIZE = 500;

// Numeric field threshold for flagging discrepancies (percentage)
export const DISCREPANCY_THRESHOLD_PERCENT = 1;

// Entity configurations - maps entity names for both systems
export const ENTITY_CONFIGS = {
  // ========================================
  // GLOBAL CONFIG
  // ========================================
  Config: {
    subgraphName: 'configs',
    hyperindexName: 'Config',
    fields: ['id', 'locked', 'lockerPaused', 'collectionCount', 'volumeETH', 'totalUsers', 'totalFeesETH', 'feeCalculator', 'protocolFeeRecipient', 'staleTimeWindow'],
    nestedFields: {
      'feeDistribution': 'feeDistribution_id'
    },
    fieldMapping: {}
  },
  Bundle: {
    subgraphName: 'bundles',
    hyperindexName: 'Bundle',
    fields: ['id', 'ethPriceUSDC'],
    nestedFields: {},
    fieldMapping: {}
  },

  // ========================================
  // USERS & HOLDINGS
  // ========================================
  User: {
    subgraphName: 'users',
    hyperindexName: 'User',
    fields: ['id'],
    nestedFields: {},
    fieldMapping: {}
  },
  UserAggregate: {
    subgraphName: 'userAggregates',
    hyperindexName: 'UserAggregate',
    fields: ['id', 'totalReferrerFeesETH'],
    nestedFields: {
      'user': 'user_id'
    },
    fieldMapping: {}
  },
  TokenReferralFee: {
    subgraphName: 'tokenReferralFees',
    hyperindexName: 'TokenReferralFee',
    fields: ['id', 'totalAmount', 'isFleth'],
    nestedFields: {
      'collectionToken': 'collectionToken_id',
      'user': 'user_id'
    },
    fieldMapping: {}
  },
  CollectionTokenHolding: {
    subgraphName: 'collectionTokenHoldings',
    hyperindexName: 'CollectionTokenHolding',
    fields: ['id', 'balance', 'balanceBefore', 'createdTx', 'createdTimestamp', 'updatedTx', 'updatedTimestamp', 'lastUpdatedTimestamp', 'price'],
    nestedFields: {
      'user': 'user_id',
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {},
    knownIdMismatch: true
  },
  CollectionTokenHoldingChange: {
    subgraphName: 'collectionTokenHoldingChanges',
    hyperindexName: 'CollectionTokenHoldingChange',
    fields: ['id', 'counterpartEOA', 'balanceAfter', 'balanceBefore', 'priceBefore', 'priceAfter', 'isIncrement', 'createdTx', 'created'],
    nestedFields: {
      'collectionToken': 'collectionToken_id',
      'owner': 'owner_id'
    },
    fieldMapping: {},
    knownIdMismatch: true
  },
  CollectionHolding: {
    subgraphName: 'collectionHoldings',
    hyperindexName: 'CollectionHolding',
    fields: ['id', 'nftAddress', 'tokenId'],
    nestedFields: {
      'owner': 'owner_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // LOOKUP TABLES
  // ========================================
  NFTLookup: {
    subgraphName: 'nftlookups',
    hyperindexName: 'NFTLookup',
    fields: ['id'],
    nestedFields: {
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },
  PoolCollectionLookup: {
    subgraphName: 'poolCollectionLookups',
    hyperindexName: 'PoolCollectionLookup',
    fields: ['id'],
    nestedFields: {
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // TREASURY MANAGER IMPLEMENTATIONS
  // ========================================
  TreasuryManagerImplementation: {
    subgraphName: 'treasuryManagerImplementations',
    hyperindexName: 'TreasuryManagerImplementation',
    fields: ['id', 'approvedAt', 'unapprovedAt'],
    nestedFields: {},
    fieldMapping: {}
  },
  RevenueManager: {
    subgraphName: 'revenueManagers',
    hyperindexName: 'RevenueManager',
    fields: ['id', 'deployer', 'managerImplementation', 'permissions', 'createdAt', 'protocolFee'],
    nestedFields: {
      'owner': 'owner_id',
      'protocolFeeRecipient': 'protocolFeeRecipient_id'
    },
    fieldMapping: {}
  },
  RevenueManagerClaim: {
    subgraphName: 'revenueManagerClaims',
    hyperindexName: 'RevenueManagerClaim',
    fields: ['id', 'isProtocol', 'amount', 'amountUSDC', 'timestamp', 'txHash'],
    nestedFields: {
      'revenueManager': 'revenueManager_id',
      'collection': 'collection_id',
      'recipient': 'recipient_id'
    },
    fieldMapping: {}
  },
  AddressFeeSplitManager: {
    subgraphName: 'addressFeeSplitManagers',
    hyperindexName: 'AddressFeeSplitManager',
    fields: ['id', 'deployer', 'managerImplementation', 'permissions', 'createdAt', 'creatorShare', 'externalManagerETHTotal'],
    nestedFields: {
      'owner': 'owner_id'
    },
    fieldMapping: {}
  },
  AddressFeeSplitManagerRecipient: {
    subgraphName: 'addressFeeSplitManagerRecipients',
    hyperindexName: 'AddressFeeSplitManagerRecipient',
    fields: ['id', 'recipient', 'recipientShare'],
    nestedFields: {
      'manager': 'manager_id'
    },
    fieldMapping: {}
  },
  AddressFeeSplitManagerClaim: {
    subgraphName: 'addressFeeSplitManagerClaims',
    hyperindexName: 'AddressFeeSplitManagerClaim',
    fields: ['id', 'amount', 'amountUSDC', 'timestamp', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'recipient': 'recipient_id'
    },
    fieldMapping: {}
  },
  AddressFeeSplitManagerExternalETH: {
    subgraphName: 'addressFeeSplitManagerExternalETHs',
    hyperindexName: 'AddressFeeSplitManagerExternalETH',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'user': 'user_id'
    },
    fieldMapping: {}
  },
  StakingManager: {
    subgraphName: 'stakingManagers',
    hyperindexName: 'StakingManager',
    fields: ['id', 'deployer', 'managerImplementation', 'permissions', 'createdAt', 'minEscrowDuration', 'minStakeDuration', 'creatorShare', 'ownerShare', 'totalStaked', 'totalStakers', 'externalManagerETHTotal'],
    nestedFields: {
      'owner': 'owner_id',
      'stakingToken': 'stakingToken_id'
    },
    fieldMapping: {}
  },
  StakingManagerStake: {
    subgraphName: 'stakingManagerStakes',
    hyperindexName: 'StakingManagerStake',
    fields: ['id', 'amount', 'unlocksAt', 'createdAt', 'updatedAt'],
    nestedFields: {
      'manager': 'manager_id',
      'user': 'user_id'
    },
    fieldMapping: {}
  },
  StakingManagerStakeDelta: {
    subgraphName: 'stakingManagerStakeDeltas',
    hyperindexName: 'StakingManagerStakeDelta',
    fields: ['id', 'amount', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'user': 'user_id',
      'stake': 'stake_id'
    },
    fieldMapping: {}
  },
  StakingManagerEscrow: {
    subgraphName: 'stakingManagerEscrows',
    hyperindexName: 'StakingManagerEscrow',
    fields: ['id', 'timelockedUntil', 'createdAt', 'updatedAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'collection': 'collection_id'
    },
    fieldMapping: {}
  },
  StakingManagerClaim: {
    subgraphName: 'stakingManagerClaims',
    hyperindexName: 'StakingManagerClaim',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'recipient': 'recipient_id'
    },
    fieldMapping: {}
  },
  StakingManagerExternalETH: {
    subgraphName: 'stakingManagerExternalETHs',
    hyperindexName: 'StakingManagerExternalETH',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'user': 'user_id'
    },
    fieldMapping: {}
  },
  BuyBackManager: {
    subgraphName: 'buyBackManagers',
    hyperindexName: 'BuyBackManager',
    fields: ['id', 'deployer', 'managerImplementation', 'permissions', 'createdAt', 'creatorShare', 'ownerShare', 'buyBackCurrency0', 'buyBackCurrency1', 'totalDeposits', 'totalDepositsUSDC', 'externalManagerETHTotal'],
    nestedFields: {
      'owner': 'owner_id'
    },
    fieldMapping: {}
  },
  BuyBackManagerDeposit: {
    subgraphName: 'buyBackManagerDeposits',
    hyperindexName: 'BuyBackManagerDeposit',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id'
    },
    fieldMapping: {}
  },
  BuyBackManagerClaim: {
    subgraphName: 'buyBackManagerClaims',
    hyperindexName: 'BuyBackManagerClaim',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'collection': 'collection_id',
      'recipient': 'recipient_id'
    },
    fieldMapping: {}
  },
  BuyBackManagerExternalETH: {
    subgraphName: 'buyBackManagerExternalETHs',
    hyperindexName: 'BuyBackManagerExternalETH',
    fields: ['id', 'amount', 'amountUSDC', 'createdAt', 'txHash'],
    nestedFields: {
      'manager': 'manager_id',
      'user': 'user_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // COLLECTIONS & TOKENS
  // ========================================
  Collection: {
    subgraphName: 'collections',
    hyperindexName: 'Collection',
    fields: ['id', 'contract', 'tokenID', 'name', 'symbol', 'managerType', 'managerUpdatedAt'],
    nestedFields: {
      'creator': 'creator_id',
      'owner': 'owner_id',
      'collectionToken': 'collectionToken_id',
      'revenueManager': 'revenueManager_id',
      'addressFeeSplitManager': 'addressFeeSplitManager_id',
      'stakingManager': 'stakingManager_id',
      'buyBackManager': 'buyBackManager_id'
    },
    fieldMapping: {}
  },
  CollectionMetadata: {
    subgraphName: 'collectionMetadatas',
    hyperindexName: 'CollectionMetadata',
    fields: ['id', 'name', 'description', 'logoHash', 'symbol', 'website', 'discord', 'twitter', 'telegram'],
    nestedFields: {
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },
  CollectionToken: {
    subgraphName: 'collectionTokens',
    hyperindexName: 'CollectionToken',
    fields: [
      'id', 'name', 'symbol', 'totalSupply', 'marketCapETH', 'volumeETH',
      'totalFeesETH', 'tokenPrice', 'totalHolders', 'decimals', 'createdAt',
      'baseURI', 'isNative', 'derivedETH', 'creationFee',
      'lastMinuteArchived', 'lastHourArchived', 'lastFifteenMinuteArchived', 'lastFourHourArchived',
      'lastMinuteRecorded', 'lastHourRecorded', 'lastFifteenMinuteRecorded', 'lastFourHourRecorded'
    ],
    nestedFields: {
      'creator': 'creator_id',
      'owner': 'owner_id',
      'pool': 'pool_id',
      'collection': 'collection_id',
      'metadata': 'metadata_id',
      'fairLaunch': 'fairLaunch_id'
    },
    fieldMapping: {}
  },
  ImportedToken: {
    subgraphName: 'importedTokens',
    hyperindexName: 'ImportedToken',
    fields: ['id', 'verifier', 'sender', 'importedAt', 'txHash'],
    nestedFields: {
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },
  TokenImporterVerifier: {
    subgraphName: 'tokenImporterVerifiers',
    hyperindexName: 'TokenImporterVerifier',
    fields: ['id'],
    nestedFields: {},
    fieldMapping: {}
  },
  Token: {
    subgraphName: 'tokens',
    hyperindexName: 'Token',
    fields: ['id', 'name', 'symbol', 'decimals', 'totalSupply'],
    nestedFields: {},
    fieldMapping: {}
  },

  // ========================================
  // POOLS & SWAPS
  // ========================================
  Pool: {
    subgraphName: 'pools',
    hyperindexName: 'Pool',
    fields: [
      'id', 'sqrtPriceX96', 'tick', 'volumeETH', 'totalFeesETH', 'totalFeesToken',
      'liquidity', 'tickSpacing', 'flipped', 'fairLaunchedEnded', 'positionManager',
      'liveAtTimestamp', 'startingMarketCap', 'startingMarketCapETH',
      'totalFeesTokenConverted', 'ispEthIn', 'ispTokenOut'
    ],
    nestedFields: {
      'collectionToken': 'collectionToken_id',
      'poolFees': 'poolFees_id',
      'bidWall': 'bidWall_id',
      'feeDistribution': 'feeDistribution_id',
      'memecoinTreasury': 'memecoinTreasury_id',
      'feeAllocation': 'feeAllocation_id'
    },
    fieldMapping: {}
  },
  PoolSwap: {
    subgraphName: 'poolSwaps',
    hyperindexName: 'PoolSwap',
    fields: [
      'id', 'timestamp', 'txHash', 'swapType',
      'fairLaunchAmount0', 'fairLaunchAmount1',
      'ispAmount0', 'ispAmount1',
      'uniswapAmount0', 'uniswapAmount1',
      'fairLaunchFee0', 'fairLaunchFee1',
      'ispFee0', 'ispFee1',
      'uniswapFee0', 'uniswapFee1',
      'flAmountUSDC', 'ispAmountUSDC', 'uniAmountUSDC', 'totalAmountUSDC'
    ],
    nestedFields: {
      'maker': 'maker_id',
      'pool': 'pool_id',
      'userHolding': 'userHolding_id'
    },
    fieldMapping: {},
    knownIdMismatch: true
  },
  PoolFees: {
    subgraphName: 'poolFees',
    hyperindexName: 'PoolFees',
    fields: ['id', 'ethAvailable', 'tokenAvailable', 'totalTokenIn', 'totalEthIn'],
    nestedFields: {},
    fieldMapping: {}
  },
  PoolFeeDistribution: {
    subgraphName: 'poolFeeDistributions',
    hyperindexName: 'PoolFeeDistribution',
    fields: ['id', 'timestamp', 'amount', 'creatorAmount', 'bidWallAmount', 'governanceAmount', 'protocolAmount'],
    nestedFields: {
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  FeeAllocation: {
    subgraphName: 'feeAllocations',
    hyperindexName: 'FeeAllocation',
    fields: ['id', 'community', 'creator'],
    nestedFields: {},
    fieldMapping: {}
  },
  PoolPremine: {
    subgraphName: 'poolPremines',
    hyperindexName: 'PoolPremine',
    fields: ['id', 'amount'],
    nestedFields: {
      'receiver': 'receiver_id',
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // BIDWALL & FAIRLAUNCH
  // ========================================
  BidWall: {
    subgraphName: 'bidWalls',
    hyperindexName: 'BidWall',
    fields: ['id', 'contract', 'initialized', 'tickLower', 'tickUpper', 'amount', 'balance', 'deployedETH', 'closed'],
    nestedFields: {
      'collectionToken': 'collectionToken_id',
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  BidWallDistribution: {
    subgraphName: 'bidWallDistributions',
    hyperindexName: 'BidWallDistribution',
    fields: ['id', 'amount'],
    nestedFields: {
      'bidWall': 'bidWall_id',
      'collectionToken': 'collectionToken_id',
      'recipient': 'recipient_id'
    },
    fieldMapping: {}
  },
  BidWallRepositioned: {
    subgraphName: 'bidWallRepositioneds',
    hyperindexName: 'BidWallRepositioned',
    fields: ['id', '_eth', '_tickLower', '_tickUpper', 'blockNumber', 'blockTimestamp', 'transactionHash'],
    nestedFields: {
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  FairLaunch: {
    subgraphName: 'fairLaunches',
    hyperindexName: 'FairLaunch',
    fields: ['id', 'active', 'tick', 'initialSupply', 'ethEarned', 'soldInitialSupply', 'starts_at', 'ends_at'],
    nestedFields: {
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // FEES & DISTRIBUTIONS
  // ========================================
  FeeDistribution: {
    subgraphName: 'feeDistributions',
    hyperindexName: 'FeeDistribution',
    fields: ['id', 'swapFee', 'referrer', 'protocol', 'community', 'active', 'creator'],
    nestedFields: {},
    fieldMapping: {}
  },
  FeeExemption: {
    subgraphName: 'feeExemptions',
    hyperindexName: 'FeeExemption',
    fields: ['id', 'flatFee'],
    nestedFields: {},
    fieldMapping: {}
  },
  FlaunchFeeExemption: {
    subgraphName: 'flaunchFeeExemptions',
    hyperindexName: 'FlaunchFeeExemption',
    fields: ['id', 'createdAt'],
    nestedFields: {},
    fieldMapping: {}
  },
  UserFee: {
    subgraphName: 'userFees',
    hyperindexName: 'UserFee',
    fields: ['id', 'claimableAmount', 'claimableAmountUSDC', 'lifetimeFees', 'totalClaimed', 'totalClaimedUSDC', 'updatedAt'],
    nestedFields: {
      'payee': 'payee_id'
    },
    fieldMapping: {}
  },
  UserFeeClaimed: {
    subgraphName: 'userFeeClaimeds',
    hyperindexName: 'UserFeeClaimed',
    fields: ['id', 'amount', 'amountUSDC', 'date', 'txHash'],
    nestedFields: {
      'payee': 'payee_id'
    },
    fieldMapping: {}
  },
  UserCollectionFee: {
    subgraphName: 'userCollectionFees',
    hyperindexName: 'UserCollectionFee',
    fields: ['id', 'lifetimeFees', 'updatedAt'],
    nestedFields: {
      'user': 'user_id',
      'collectionToken': 'collectionToken_id'
    },
    fieldMapping: {}
  },
  CollectionFee: {
    subgraphName: 'collectionFees',
    hyperindexName: 'CollectionFee',
    fields: ['id', 'lifetimeFees', 'updatedAt'],
    nestedFields: {},
    fieldMapping: {}
  },
  ReferrerFee: {
    subgraphName: 'referrerFees',
    hyperindexName: 'ReferrerFee',
    fields: ['id', 'txHash', 'isETH', 'amount', 'amountInETH', 'timestamp'],
    nestedFields: {
      'pool': 'pool_id',
      'recipient': 'recipient_id',
      'token': 'token_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // REFERRAL ESCROW
  // ========================================
  ReferralEscrowAssigned: {
    subgraphName: 'referralEscrowAssigneds',
    hyperindexName: 'ReferralEscrowAssigned',
    fields: ['id', 'amount', 'timestamp', 'txHash'],
    nestedFields: {
      'receiver': 'receiver_id',
      'token': 'token_id'
    },
    fieldMapping: {}
  },
  ReferralEscrowClaimed: {
    subgraphName: 'referralEscrowClaimeds',
    hyperindexName: 'ReferralEscrowClaimed',
    fields: ['id', 'amount', 'amountUSDC', 'timestamp', 'txHash'],
    nestedFields: {
      'receiver': 'receiver_id',
      'token': 'token_id'
    },
    fieldMapping: {}
  },
  ReferralEscrowSwapped: {
    subgraphName: 'referralEscrowSwappeds',
    hyperindexName: 'ReferralEscrowSwapped',
    fields: ['id', 'ethOut', 'tokensIn', 'timestamp', 'txHash'],
    nestedFields: {
      'receiver': 'receiver_id',
      'token': 'token_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // TIME SERIES DATA
  // ========================================
  TokenDayData: {
    subgraphName: 'tokenDayDatas',
    hyperindexName: 'TokenDayData',
    fields: [
      'id', 'date', 'periodStartUnix', 'volumeETH', 'volumeUSDC', 'totalVolumeETH', 'totalVolumeUSDC',
      'marketCapETH', 'marketCapUSDC', 'priceETH', 'priceUSDC', 'feesETH', 'feesUSDC', 'totalFeesETH', 'totalFeesUSDC',
      'priceOpen', 'priceOpenUSDC', 'priceHigh', 'priceHighUSDC', 'priceLow', 'priceLowUSDC', 'priceClose', 'priceCloseUSDC'
    ],
    nestedFields: {
      'token': 'token_id',
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  TokenHourData: {
    subgraphName: 'tokenHourDatas',
    hyperindexName: 'TokenHourData',
    fields: [
      'id', 'periodStartUnix', 'volumeETH', 'volumeUSDC', 'totalVolumeETH', 'totalVolumeUSDC',
      'marketCapETH', 'marketCapUSDC', 'priceETH', 'priceUSDC', 'feesETH', 'feesUSDC', 'totalFeesETH', 'totalFeesUSDC',
      'priceOpen', 'priceOpenUSDC', 'priceHigh', 'priceHighUSDC', 'priceLow', 'priceLowUSDC', 'priceClose', 'priceCloseUSDC'
    ],
    nestedFields: {
      'token': 'token_id',
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  TokenMinuteData: {
    subgraphName: 'tokenMinuteDatas',
    hyperindexName: 'TokenMinuteData',
    fields: [
      'id', 'periodStartUnix', 'volumeETH', 'volumeUSDC', 'totalVolumeETH', 'totalVolumeUSDC',
      'marketCapETH', 'marketCapUSDC', 'priceETH', 'priceUSDC', 'feesETH', 'feesUSDC', 'totalFeesETH', 'totalFeesUSDC',
      'priceOpen', 'priceOpenUSDC', 'priceHigh', 'priceHighUSDC', 'priceLow', 'priceLowUSDC', 'priceClose', 'priceCloseUSDC'
    ],
    nestedFields: {
      'token': 'token_id'
    },
    fieldMapping: {}
  },
  Token15MinuteData: {
    subgraphName: 'token15MinuteDatas',
    hyperindexName: 'Token15MinuteData',
    fields: [
      'id', 'periodStartUnix', 'volumeETH', 'volumeUSDC', 'totalVolumeETH', 'totalVolumeUSDC',
      'marketCapETH', 'marketCapUSDC', 'priceETH', 'priceUSDC', 'feesETH', 'feesUSDC', 'totalFeesETH', 'totalFeesUSDC',
      'priceOpen', 'priceOpenUSDC', 'priceHigh', 'priceHighUSDC', 'priceLow', 'priceLowUSDC', 'priceClose', 'priceCloseUSDC'
    ],
    nestedFields: {
      'token': 'token_id'
    },
    fieldMapping: {}
  },
  Token4HourData: {
    subgraphName: 'token4HourDatas',
    hyperindexName: 'Token4HourData',
    fields: [
      'id', 'periodStartUnix', 'volumeETH', 'volumeUSDC', 'totalVolumeETH', 'totalVolumeUSDC',
      'marketCapETH', 'marketCapUSDC', 'priceETH', 'priceUSDC', 'feesETH', 'feesUSDC', 'totalFeesETH', 'totalFeesUSDC',
      'priceOpen', 'priceOpenUSDC', 'priceHigh', 'priceHighUSDC', 'priceLow', 'priceLowUSDC', 'priceClose', 'priceCloseUSDC'
    ],
    nestedFields: {
      'token': 'token_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // ACTIVITY & LOGS
  // ========================================
  Activity: {
    subgraphName: 'activities',
    hyperindexName: 'Activity',
    fields: ['id', 'timestamp', 'txHash', 'amountETH', 'amountToken', 'activityType'],
    nestedFields: {
      'maker': 'maker_id',
      'token': 'token_id'
    },
    fieldMapping: {},
    knownIdMismatch: true
  },

  // ========================================
  // MEMECOIN TREASURY
  // ========================================
  MemecoinTreasury: {
    subgraphName: 'memecoinTreasuries',
    hyperindexName: 'MemecoinTreasury',
    fields: ['id', 'createdAt', 'totalActions', 'lastActionTimestamp', 'totalETH', 'totalToken'],
    nestedFields: {
      'pool': 'pool_id'
    },
    fieldMapping: {}
  },
  MemecoinTreasuryActivity: {
    subgraphName: 'memecoinTreasuryActivities',
    hyperindexName: 'MemecoinTreasuryActivity',
    fields: ['id', 'tokenDelta0', 'tokenDelta1', 'timestamp', 'transactionHash', 'blockNumber'],
    nestedFields: {
      'pool': 'pool_id',
      'treasury': 'treasury_id',
      'action': 'action_id'
    },
    fieldMapping: {}
  },
  MemecoinAction: {
    subgraphName: 'memecoinActions',
    hyperindexName: 'MemecoinAction',
    fields: ['id', 'approved', 'approvedAt', 'unapprovedAt', 'totalActions', 'approvedBy', 'unapprovedBy'],
    nestedFields: {},
    fieldMapping: {}
  },

  // ========================================
  // FLAUNCH APPROVAL
  // ========================================
  FlaunchApproval: {
    subgraphName: 'flaunchApprovals',
    hyperindexName: 'FlaunchApproval',
    fields: ['id', 'flaunchAddr', 'globalApproval'],
    nestedFields: {
      'owner': 'owner_id',
      'operator': 'operator_id'
    },
    fieldMapping: {}
  },
  FlaunchApprovalToken: {
    subgraphName: 'flaunchApprovalTokens',
    hyperindexName: 'FlaunchApprovalToken',
    fields: ['id', 'tokenId', 'createdAt', 'txHash'],
    nestedFields: {
      'flaunchApproval': 'flaunchApproval_id',
      'collection': 'collection_id'
    },
    fieldMapping: {}
  },

  // ========================================
  // MISC
  // ========================================
  FlayBurner: {
    subgraphName: 'flayBurners',
    hyperindexName: 'FlayBurner',
    fields: ['id', 'address', 'pendingETH', 'totalBurned', 'createdAt'],
    nestedFields: {},
    fieldMapping: {}
  }
} as const;

export type EntityName = keyof typeof ENTITY_CONFIGS;
export type EntityConfig = typeof ENTITY_CONFIGS[EntityName];
