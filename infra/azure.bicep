@description('Base name used for all resources')
param baseName string = 'probtrk'

@description('Environment suffix, e.g. dev/test/prod')
param envSuffix string = 'dev'

@description('Location for all resources')
param location string = resourceGroup().location

@description('SKU for the App Service Plan')
param appServicePlanSku string = 'B1'

@description('Node runtime version for the App Service')
param nodeVersion string = 'NODE|22-lts'

var uniq = toLower(uniqueString(resourceGroup().id, baseName, envSuffix))
var storageAccountName = take('st${baseName}${envSuffix}${uniq}', 24)
var appServicePlanName = 'asp-${baseName}-${envSuffix}-${uniq}'
var appServiceName = 'app-${baseName}-${envSuffix}-${uniq}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource tProbationers 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'Probationers'
}

resource tObjectives 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'Objectives'
}

resource tCheckIns 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'CheckIns'
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: { name: appServicePlanSku }
  kind: 'linux'
  properties: { reserved: true }
}

var storageKey = storage.listKeys().keys[0].value
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storageKey};EndpointSuffix=${environment().suffixes.storage}'

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeVersion
      appCommandLine: 'node server/dist/index.js'
      alwaysOn: appServicePlanSku != 'F1' && appServicePlanSku != 'D1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      cors: {
        allowedOrigins: [ '*' ]
      }
      appSettings: [
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
        { name: 'AZURE_STORAGE_CONNECTION_STRING', value: storageConnectionString }
      ]
    }
  }
}

output appServiceName string = site.name
output appServiceHostName string = site.properties.defaultHostName
output appServiceUrl string = 'https://${site.properties.defaultHostName}'
output storageAccountName string = storage.name
#disable-next-line outputs-should-not-contain-secrets
output storageConnectionString string = storageConnectionString
