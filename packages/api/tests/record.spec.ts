import type { PortableDid } from '@web5/dids';
import type { ManagedIdentity } from '@web5/agent';
import type {
  RecordsWriteMessage,
  PublicJwk as DwnPublicKeyJwk,
  PrivateJwk as DwnPrivateKeyJwk,
  EncryptionInput,
} from '@tbd54566975/dwn-sdk-js';

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { utils as didUtils } from '@web5/dids';
import { TestManagedAgent } from '@web5/agent';
import {
  DwnConstant,
  RecordsWrite,
  DwnMethodName,
  DwnInterfaceName,
  EncryptionAlgorithm,
  KeyDerivationScheme,
} from '@tbd54566975/dwn-sdk-js';

import { Record } from '../src/record.js';
import { DwnApi } from '../src/dwn-api.js';
import { dataToBlob } from '../src/utils.js';
import { testDwnUrl } from './test-config.js';
import { TestUserAgent } from './utils/test-user-agent.js';
import { TestDataGenerator } from './utils/test-data-generator.js';
import emailProtocolDefinition from './fixtures/protocol-definitions/email.json' assert { type: 'json' };

chai.use(chaiAsPromised);

// NOTE: @noble/secp256k1 requires globalThis.crypto polyfill for node.js <=18: https://github.com/paulmillr/noble-secp256k1/blob/main/README.md#usage
// Remove when we move off of node.js v18 to v20, earliest possible time would be Oct 2023: https://github.com/nodejs/release#release-schedule
// NOTE: @noble/secp256k1 requires globalThis.crypto polyfill for node.js <=18: https://github.com/paulmillr/noble-secp256k1/blob/main/README.md#usage
// Remove when we move off of node.js v18 to v20, earliest possible time would be Oct 2023: https://github.com/nodejs/release#release-schedule
import { webcrypto } from 'node:crypto';
import { PrivateKeySigner } from '@tbd54566975/dwn-sdk-js';
// @ts-ignore
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// TODO: Come up with a better way of resolving the TS errors.
type RecordsWriteTest = RecordsWrite & RecordsWriteMessage;

let testDwnUrls: string[] = [testDwnUrl];

describe('Record', () => {
  let dataText: string;
  let dataBlob: Blob;
  let dataFormat: string;
  let dwn: DwnApi;
  let alice: ManagedIdentity;
  let aliceDid: PortableDid;
  let testAgent: TestManagedAgent;

  before(async () => {
    testAgent = await TestManagedAgent.create({
      agentClass  : TestUserAgent,
      agentStores : 'memory'
    });

    dataText = TestDataGenerator.randomString(100);
    ({ dataBlob, dataFormat } = dataToBlob(dataText));
  });

  beforeEach(async () => {
    await testAgent.clearStorage();

    // Create an Agent DID.
    await testAgent.createAgentDid();

    // Create a new Identity to author the DWN messages.
    ({ did: aliceDid } = await testAgent.createIdentity({ testDwnUrls }));
    alice = await testAgent.agent.identityManager.import({
      did      : aliceDid,
      identity : { name: 'Alice', did: aliceDid.did },
      kms      : 'local'
    });

    // Instantiate DwnApi.
    dwn = new DwnApi({ agent: testAgent.agent, connectedDid: alice.did });
  });

  after(async () => {
    await testAgent.clearStorage();
    await testAgent.closeStorage();
  });

  it('should retain all defined properties', async () => {
    // RecordOptions properties
    const author = alice.did;
    const target = alice.did;

    // Retrieve `#dwn` service entry.
    const [ didDwnService ] = didUtils.getServices({ didDocument: aliceDid.document, id: '#dwn' });

    // Retrieve first message signing key from the #dwn service endpoint.
    if (!didUtils.isDwnServiceEndpoint(didDwnService.serviceEndpoint)) throw Error('Type guard');
    const [ signingKeyIdFragment ] = didDwnService!.serviceEndpoint!.signingKeys;
    const [ encryptionKeyIdFragment ] = didDwnService!.serviceEndpoint!.encryptionKeys;

    const signingKeyId = `${alice.did}${signingKeyIdFragment}`;
    const signingKeyPair = aliceDid.keySet.verificationMethodKeys!.find(keyPair => keyPair.publicKeyJwk.kid === signingKeyIdFragment);
    const signingPrivateKeyJwk = signingKeyPair.privateKeyJwk;

    const encryptionKeyId = `${alice.did}${encryptionKeyIdFragment}`;
    const encryptionPublicKeyJwk = aliceDid.keySet.verificationMethodKeys!.find(keyPair => keyPair.publicKeyJwk.kid === encryptionKeyIdFragment)!.publicKeyJwk;

    // RecordsWriteMessage properties that can be pre-defined
    const attestation = [new PrivateKeySigner({
      privateJwk : signingPrivateKeyJwk as DwnPrivateKeyJwk,
      algorithm  : signingPrivateKeyJwk.alg as string,
      keyId      : signingKeyId,
    })];

    const authorization = new PrivateKeySigner({
      privateJwk : signingPrivateKeyJwk as DwnPrivateKeyJwk,
      algorithm  : signingPrivateKeyJwk.alg as string,
      keyId      : signingKeyId,
    });

    const encryptionInput: EncryptionInput = {
      algorithm            : EncryptionAlgorithm.Aes256Ctr,
      initializationVector : TestDataGenerator.randomBytes(16),
      key                  : TestDataGenerator.randomBytes(32),
      keyEncryptionInputs  : [{
        algorithm        : EncryptionAlgorithm.EciesSecp256k1,
        derivationScheme : KeyDerivationScheme.ProtocolPath,
        publicKey        : encryptionPublicKeyJwk as DwnPublicKeyJwk,
        publicKeyId      : encryptionKeyId
      }]
    };

    // RecordsWriteDescriptor properties that can be pre-defined
    const protocol = emailProtocolDefinition.protocol;
    const protocolPath = 'email';
    const schema = emailProtocolDefinition.types.email.schema;
    const recipient = alice.did;
    const published = true;

    // Install a protocol on Alice's agent connected DWN.
    await dwn.protocols.configure({
      message: {
        definition: emailProtocolDefinition
      }
    });

    // Create a parent record to reference in the RecordsWriteMessage used for validation
    const parentRecorsWrite = await RecordsWrite.create({
      data   : new Uint8Array(await dataBlob.arrayBuffer()),
      dataFormat,
      protocol,
      protocolPath,
      schema,
      signer : authorization,
    }) as RecordsWriteTest;

    // Create a RecordsWriteMessage
    const recordsWrite = await RecordsWrite.create({
      attestationSigners : attestation,
      data               : new Uint8Array(await dataBlob.arrayBuffer()),
      dataFormat,
      encryptionInput,
      parentId           : parentRecorsWrite.recordId,
      protocol,
      protocolPath,
      published,
      recipient,
      schema,
      signer             : authorization,
    }) as RecordsWriteTest;

    // Create record using test RecordsWriteMessage.
    const record = new Record(testAgent.agent, {
      ...recordsWrite.message,
      encodedData: dataBlob,
      target,
      author,
    });

    // Retained Record properties
    expect(record.author).to.equal(author);
    expect(record.target).to.equal(target);

    // Retained RecordsWriteMessage top-level properties
    expect(record.contextId).to.equal(recordsWrite.message.contextId);
    expect(record.id).to.equal(recordsWrite.message.recordId);
    expect(record.encryption).to.not.be.undefined;
    expect(record.encryption).to.deep.equal(recordsWrite.message.encryption);
    expect(record.encryption!.keyEncryption.find(key => key.derivationScheme === KeyDerivationScheme.ProtocolPath));
    expect(record.attestation).to.not.be.undefined;
    expect(record.attestation).to.have.property('signatures');

    // Retained RecordsWriteDescriptor properties
    expect(record.protocol).to.equal(protocol);
    expect(record.protocolPath).to.equal(protocolPath);
    expect(record.recipient).to.equal(recipient);
    expect(record.schema).to.equal(schema);
    expect(record.parentId).to.equal(parentRecorsWrite.recordId);
    expect(record.dataCid).to.equal(recordsWrite.message.descriptor.dataCid);
    expect(record.dataSize).to.equal(recordsWrite.message.descriptor.dataSize);
    expect(record.dateCreated).to.equal(recordsWrite.message.descriptor.dateCreated);
    expect(record.dateModified).to.equal(recordsWrite.message.descriptor.messageTimestamp);
    expect(record.published).to.equal(published);
    expect(record.datePublished).to.equal(recordsWrite.message.descriptor.datePublished);
    expect(record.dataFormat).to.equal(dataFormat);
  });

  describe('data.blob()', () => {
    it('returns small data payloads after dwn.records.write()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.blob() is executed.
      const dataJson = TestDataGenerator.randomJson(500);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Confirm that the size, in bytes, of the data read as a Blob matches the original input data.
      const readDataBlob = await record!.data.blob();
      expect(readDataBlob.size).to.equal(inputDataBytes.length);

      // Convert the Blob into an array and ensure it matches the input data byte for byte.
      const readDataBytes = new Uint8Array(await readDataBlob.arrayBuffer());
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns small data payloads after dwn.records.read()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.blob() is executed.
      const dataJson = TestDataGenerator.randomJson(500);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as a Blob matches the original input data.
      const readDataBlob = await readRecord.data.blob();
      expect(readDataBlob.size).to.equal(inputDataBytes.length);

      // Convert the Blob into an array and ensure it matches the input data byte for byte.
      const readDataBytes = new Uint8Array(await readDataBlob.arrayBuffer());
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.write()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.blob() is executed.
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Confirm that the size, in bytes, of the data read as a Blob matches the original input data.
      const readDataBlob = await record!.data.blob();
      expect(readDataBlob.size).to.equal(inputDataBytes.length);

      // Convert the Blob into an array and ensure it matches the input data byte for byte.
      const readDataBytes = new Uint8Array(await readDataBlob.arrayBuffer());
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.query()', async () => {
      /** Generate data that exceeds the DWN encoded data limit to ensure that the data will have to
       * be fetched with a RecordsRead when record.data.blob() is executed. */
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });
      expect(status.code).to.equal(202);

      // Query for the record that was just created.
      const { records: queryRecords, status: queryRecordStatus } = await dwn.records.query({
        message: { filter: { recordId: record!.id }}
      });
      expect(queryRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as a Blob matches the original input data.
      const [ queryRecord ] = queryRecords;
      const queriedDataBlob = await queryRecord.data.blob();
      expect(queriedDataBlob.size).to.equal(inputDataBytes.length);

      // Convert the Blob into an array and ensure it matches the input data, byte for byte.
      const queriedDataBytes = new Uint8Array(await queriedDataBlob.arrayBuffer());
      expect(queriedDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.read()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.blob() is executed.
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as a Blob matches the original input data.
      const readDataBlob = await readRecord.data.blob();
      expect(readDataBlob.size).to.equal(inputDataBytes.length);

      // Convert the Blob into an array and ensure it matches the input data byte for byte.
      const readDataBytes = new Uint8Array(await readDataBlob.arrayBuffer());
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });
  });

  describe('data.json()', () => {
    it('returns small data payloads after dwn.records.write()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.json() is executed.
      const dataJson = TestDataGenerator.randomJson(500);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Confirm that the size, in bytes, of the data read as JSON matches the original input data.
      const readDataJson = await record!.data.json();
      const readDataBytes = new TextEncoder().encode(JSON.stringify(readDataJson));
      expect(readDataBytes.length).to.equal(inputDataBytes.length);

      // Ensure the JSON returned matches the input data, byte for byte.
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns small data payloads after dwn.records.read()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.json() is executed.
      const dataJson = TestDataGenerator.randomJson(500);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as JSON matches the original input data.
      const readDataJson = await readRecord!.data.json();
      const readDataBytes = new TextEncoder().encode(JSON.stringify(readDataJson));
      expect(readDataBytes.length).to.equal(inputDataBytes.length);

      // Ensure the JSON returned matches the input data, byte for byte.
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.write()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.json() is executed.
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Confirm that the size, in bytes, of the data read as JSON matches the original input data.
      const readDataJson = await record!.data.json();
      const readDataBytes = new TextEncoder().encode(JSON.stringify(readDataJson));
      expect(readDataBytes.length).to.equal(inputDataBytes.length);

      // Ensure the JSON returned matches the input data, byte for byte.
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.query()', async () => {
      /** Generate data that exceeds the DWN encoded data limit to ensure that the data will have to
       * be fetched with a RecordsRead when record.data.json() is executed. */
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });
      expect(status.code).to.equal(202);

      // Query for the record that was just created.
      const { records: queryRecords, status: queryRecordStatus } = await dwn.records.query({
        message: { filter: { recordId: record!.id }}
      });
      expect(queryRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as JSON matches the original input data.
      const [ queryRecord ] = queryRecords;
      const queriedDataBlob = await queryRecord!.data.json();

      // Convert the JSON to bytes and ensure it matches the input data, byte for byte.
      const queriedDataBytes = new TextEncoder().encode(JSON.stringify(queriedDataBlob));
      expect(queriedDataBytes.length).to.equal(inputDataBytes.length);
      expect(queriedDataBytes).to.deep.equal(inputDataBytes);
    });

    it('returns large data payloads after dwn.records.read()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.json() is executed.
      const dataJson = TestDataGenerator.randomJson(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);
      const inputDataBytes = new TextEncoder().encode(JSON.stringify(dataJson));

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataJson });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the size, in bytes, of the data read as JSON matches the original input data.
      const readDataJson = await readRecord!.data.json();
      const readDataBytes = new TextEncoder().encode(JSON.stringify(readDataJson));
      expect(readDataBytes.length).to.equal(inputDataBytes.length);

      // Ensure the JSON returned matches the input data, byte for byte.
      expect(readDataBytes).to.deep.equal(inputDataBytes);
    });
  });

  describe('data.text()', () => {
    it('returns small data payloads after dwn.records.write()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.text() is executed.
      const dataText = TestDataGenerator.randomString(500);

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataText });

      expect(status.code).to.equal(202);

      // Confirm that the length of the data read as text matches the original input data.
      const readDataText = await record!.data.text();
      expect(readDataText.length).to.equal(dataText.length);

      // Ensure the text returned matches the input data, char for char.
      expect(readDataText).to.deep.equal(dataText);
    });

    it('returns small data payloads after dwn.records.read()', async () => {
      // Generate data that is less than the encoded data limit to ensure that the data will not have to be fetched
      // with a RecordsRead when record.data.text() is executed.
      const dataText = TestDataGenerator.randomString(500);

      // Write the 500B record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataText });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the length of the data read as text matches the original input data.
      const readDataText = await readRecord!.data.text();
      expect(readDataText.length).to.equal(dataText.length);

      // Ensure the text returned matches the input data, char for char.
      expect(readDataText).to.deep.equal(dataText);
    });

    it('returns large data payloads after dwn.records.write()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.text() is executed.
      const dataText = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataText });

      expect(status.code).to.equal(202);

      // Confirm that the length of the data read as text matches the original input data.
      const readDataText = await record!.data.text();
      expect(readDataText.length).to.equal(dataText.length);

      // Ensure the text returned matches the input data, char for char.
      expect(readDataText).to.deep.equal(dataText);
    });

    it('returns large data payloads after dwn.records.query()', async () => {
      /** Generate data that exceeds the DWN encoded data limit to ensure that the data will have to
       * be fetched with a RecordsRead when record.data.blob() is executed. */
      const dataText = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataText });
      expect(status.code).to.equal(202);

      // Query for the record that was just created.
      const { records: queryRecords, status: queryRecordStatus } = await dwn.records.query({
        message: { filter: { recordId: record!.id }}
      });
      expect(queryRecordStatus.code).to.equal(200);

      // Confirm that the length of the data read as text matches the original input data.
      const [ queryRecord ] = queryRecords;
      const queriedDataText = await queryRecord!.data.text();
      expect(queriedDataText.length).to.equal(dataText.length);

      // Ensure the text returned matches the input data, char for char.
      expect(queriedDataText).to.deep.equal(dataText);
    });

    it('returns large data payloads after dwn.records.read()', async () => {
      // Generate data that exceeds the DWN encoded data limit to ensure that the data will have to be fetched
      // with a RecordsRead when record.data.text() is executed.
      const dataText = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded + 1000);

      // Write the large record to agent-connected DWN.
      const { record, status } = await dwn.records.write({ data: dataText });

      expect(status.code).to.equal(202);

      // Read the record that was just created.
      const { record: readRecord, status: readRecordStatus } = await dwn.records.read({ message: { filter: { recordId: record!.id }}});

      expect(readRecordStatus.code).to.equal(200);

      // Confirm that the length of the data read as text matches the original input data.
      const readDataText = await readRecord!.data.text();
      expect(readDataText.length).to.equal(dataText.length);

      // Ensure the text returned matches the input data, char for char.
      expect(readDataText).to.deep.equal(dataText);
    });
  });

  describe('delete()', () => {
    it('deletes the record', async () => {
      const { status, record } = await dwn.records.write({
        data    : 'Hello, world!',
        message : {
          schema     : 'foo/bar',
          dataFormat : 'text/plain'
        }
      });

      expect(status.code).to.equal(202);
      expect(record).to.not.be.undefined;

      const deleteResult = await record!.delete();
      expect(deleteResult.status.code).to.equal(202);

      const queryResult = await dwn.records.query({
        message: {
          filter: {
            recordId: record!.id
          }
        }
      });

      expect(queryResult.status.code).to.equal(200);
      expect(queryResult.records!.length).to.equal(0);
    });

    it('throws an exception when delete is called twice', async () => {
      const { status, record } = await dwn.records.write({
        data    : 'Hello, world!',
        message : {
          schema     : 'foo/bar',
          dataFormat : 'text/plain'
        }
      });

      expect(status.code).to.equal(202);
      expect(record).to.not.be.undefined;

      let deleteResult = await record!.delete();
      expect(deleteResult.status.code).to.equal(202);

      await expect(record!.delete()).to.eventually.be.rejectedWith('Operation failed');
    });
  });

  describe('send()', () => {
    let bob: ManagedIdentity;

    beforeEach(async () => {
    // Create a new Identity to author the DWN messages.
      const { did: bobDid } = await testAgent.createIdentity({ testDwnUrls });
      bob = await testAgent.agent.identityManager.import({
        did      : bobDid,
        identity : { name: 'Bob', did: bobDid.did },
        kms      : 'local'
      });
    });

    it('writes records to remote DWNs for your own DID', async () => {
      const dataString = 'Hello, world!';

      // Alice writes a message to her agent connected DWN.
      const { status: aliceEmailStatus, record: aliceEmailRecord } = await dwn.records.write({
        data    : dataString,
        message : {
          schema: 'email',
        }
      });

      expect(aliceEmailStatus.code).to.equal(202);
      expect(await aliceEmailRecord?.data.text()).to.equal(dataString);

      // Query Alice's agent connected DWN for `email` schema records.
      const aliceAgentQueryResult = await dwn.records.query({
        message: {
          filter: {
            schema: 'email'
          }
        }
      });

      expect(aliceAgentQueryResult.status.code).to.equal(200);
      expect(aliceAgentQueryResult!.records).to.have.length(1);
      const [ aliceAgentEmailRecord ] = aliceAgentQueryResult!.records!;
      expect(await aliceAgentEmailRecord.data.text()).to.equal(dataString);

      // Attempt to write the record to Alice's remote DWN.
      const { status } = await aliceEmailRecord!.send(alice.did);
      expect(status.code).to.equal(202);

      // Query Alices's remote DWN for `email` schema records.
      const aliceRemoteQueryResult = await dwn.records.query({
        from    : alice.did,
        message : {
          filter: {
            schema: 'email'
          }
        }
      });

      expect(aliceRemoteQueryResult.status.code).to.equal(200);
      expect(aliceRemoteQueryResult.records).to.exist;
      expect(aliceRemoteQueryResult.records!.length).to.equal(1);
      const [ aliceRemoteEmailRecord ] = aliceAgentQueryResult!.records!;
      expect(await aliceRemoteEmailRecord.data.text()).to.equal(dataString);
    });

    it(`writes records to remote DWNs for someone else's DID`, async () => {
      const dataString = 'Hello, world!';

      // Install the email protocol for Alice's local DWN.
      let { protocol: aliceProtocol, status: aliceStatus } = await dwn.protocols.configure({
        message: {
          definition: emailProtocolDefinition
        }
      });

      expect(aliceStatus.code).to.equal(202);
      expect(aliceProtocol).to.exist;

      // Install the email protocol for Alice's remote DWN.
      const { status: alicePushStatus } = await aliceProtocol!.send(alice.did);
      expect(alicePushStatus.code).to.equal(202);

      // Instantiate DwnApi instance for Bob.
      const bobDwn = new DwnApi({ agent: testAgent.agent, connectedDid: bob.did });

      // Install the email protocol for Bob's local DWN.
      const { protocol: bobProtocol, status: bobStatus } = await bobDwn.protocols.configure({
        message: {
          definition: emailProtocolDefinition
        }
      });

      expect(bobStatus.code).to.equal(202);
      expect(bobProtocol).to.exist;

      // Install the email protocol for Bob's remote DWN.
      const { status: bobPushStatus } = await bobProtocol!.send(bob.did);
      expect(bobPushStatus.code).to.equal(202);

      // Alice writes a message to her own DWN.
      const { status: aliceEmailStatus, record: aliceEmailRecord } = await dwn.records.write({
        data    : dataString,
        message : {
          protocol     : emailProtocolDefinition.protocol,
          protocolPath : 'email',
          schema       : 'http://email-protocol.xyz/schema/email',
        }
      });

      expect(aliceEmailStatus.code).to.equal(202);

      // Attempt to write the message to Bob's DWN.
      const { status } = await aliceEmailRecord!.send(bob.did);
      expect(status.code).to.equal(202);

      // Query Bob's remote DWN for `email` schema records.
      const bobQueryResult = await bobDwn.records.query({
        from    : bob.did,
        message : {
          filter: {
            schema: 'http://email-protocol.xyz/schema/email'
          }
        }
      });

      expect(bobQueryResult.status.code).to.equal(200);
      expect(bobQueryResult.records).to.exist;
      expect(bobQueryResult.records!.length).to.equal(1);
      const [ bobRemoteEmailRecord ] = bobQueryResult!.records!;
      expect(await bobRemoteEmailRecord.data.text()).to.equal(dataString);
    });

    describe('with store: false', () => {
      it('writes records to your own remote DWN but not your agent DWN', async () => {
        // Alice writes a message to her agent DWN with `store: false`.
        const dataString = 'Hello, world!';
        const writeResult = await dwn.records.write({
          store   : false,
          data    : dataString,
          message : {
            dataFormat: 'text/plain'
          }
        });

        // Confirm that the request was accepted and a Record instance was returned.
        expect(writeResult.status.code).to.equal(202);
        expect(writeResult.status.detail).to.equal('Accepted');
        expect(writeResult.record).to.exist;
        expect(await writeResult.record?.data.text()).to.equal(dataString);

        // Query Alice's agent DWN for `text/plain` records.
        const queryResult = await dwn.records.query({
          message: {
            filter: {
              dataFormat: 'text/plain'
            }
          }
        });

        // Confirm no `email` schema records were written.
        expect(queryResult.status.code).to.equal(200);
        expect(queryResult.records).to.exist;
        expect(queryResult.records!.length).to.equal(0);

        // Alice writes the message to her remote DWN.
        const { status } = await writeResult.record!.send(alice.did);
        expect(status.code).to.equal(202);

        // Query Alice's remote DWN for `plain/text` records.
        const aliceRemoteQueryResult = await dwn.records.query({
          from    : alice.did,
          message : {
            filter: {
              dataFormat: 'text/plain'
            }
          }
        });

        // Confirm `email` schema record was written to Alice's remote DWN.
        expect(aliceRemoteQueryResult.status.code).to.equal(200);
        expect(aliceRemoteQueryResult.records).to.exist;
        expect(aliceRemoteQueryResult.records!.length).to.equal(1);
        const [ aliceRemoteEmailRecord ] = aliceRemoteQueryResult!.records!;
        expect(await aliceRemoteEmailRecord.data.text()).to.equal(dataString);
      });

      it(`writes records to someone else's remote DWN but not your agent DWN`, async () => {
        // Install a protocol on Alice's agent connected DWN.
        let { protocol: aliceProtocol, status: aliceStatus } = await dwn.protocols.configure({
          message: {
            definition: emailProtocolDefinition
          }
        });

        expect(aliceStatus.code).to.equal(202);
        expect(aliceProtocol).to.exist;

        // Install the protocol on Alice's remote DWN.
        const { status: alicePushStatus } = await aliceProtocol!.send(alice.did);
        expect(alicePushStatus.code).to.equal(202);

        // Instantiate DwnApi instance for Bob.
        const bobDwn = new DwnApi({ agent: testAgent.agent, connectedDid: bob.did });

        // Install the email protocol for Bob's local DWN.
        const { protocol: bobProtocol, status: bobStatus } = await bobDwn.protocols.configure({
          message: {
            definition: emailProtocolDefinition
          }
        });

        expect(bobStatus.code).to.equal(202);
        expect(bobProtocol).to.exist;

        // Install the email protocol for Bob's remote DWN.
        const { status: bobPushStatus } = await bobProtocol!.send(bob.did);
        expect(bobPushStatus.code).to.equal(202);

        // Alice writes a message to her agent DWN with `store: false`.
        const dataString = 'Hello, world!';
        const writeResult = await dwn.records.write({
          store   : false,
          data    : dataString,
          message : {
            protocol     : emailProtocolDefinition.protocol,
            protocolPath : 'email',
            schema       : 'http://email-protocol.xyz/schema/email',
          }
        });

        // Confirm that the request was accepted and a Record instance was returned.
        expect(writeResult.status.code).to.equal(202);
        expect(writeResult.status.detail).to.equal('Accepted');
        expect(writeResult.record).to.exist;
        expect(await writeResult.record?.data.text()).to.equal(dataString);

        // Query Alice's agent DWN for `email` schema records.
        const queryResult = await dwn.records.query({
          message: {
            filter: {
              schema: 'http://email-protocol.xyz/schema/email'
            }
          }
        });

        // Confirm no `email` schema records were written.
        expect(queryResult.status.code).to.equal(200);
        expect(queryResult.records).to.exist;
        expect(queryResult.records!.length).to.equal(0);

        // Alice writes the message to Bob's remote DWN.
        const { status } = await writeResult.record!.send(bob.did);
        expect(status.code).to.equal(202);

        // Query Bobs's remote DWN for `email` schema records.
        const bobQueryResult = await bobDwn.records.query({
          from    : bob.did,
          message : {
            filter: {
              dataFormat: 'text/plain'
            }
          }
        });

        // Confirm `email` schema record was written to Bob's remote DWN.
        expect(bobQueryResult.status.code).to.equal(200);
        expect(bobQueryResult.records).to.exist;
        expect(bobQueryResult.records!.length).to.equal(1);
        const [ bobRemoteEmailRecord ] = bobQueryResult!.records!;
        expect(await bobRemoteEmailRecord.data.text()).to.equal(dataString);
      });

      it('has no effect if `store: true`', async () => {
        // Alice writes a message to her agent DWN with `store: true`.
        const dataString = 'Hello, world!';
        const writeResult = await dwn.records.write({
          store   : true,
          data    : dataString,
          message : {
            dataFormat: 'text/plain'
          }
        });

        // Confirm that the request was accepted and a Record instance was returned.
        expect(writeResult.status.code).to.equal(202);
        expect(writeResult.status.detail).to.equal('Accepted');
        expect(writeResult.record).to.exist;
        expect(await writeResult.record?.data.text()).to.equal(dataString);

        // Query Alice's agent DWN for `text/plain` records.
        const queryResult = await dwn.records.query({
          message: {
            filter: {
              dataFormat: 'text/plain'
            }
          }
        });

        // Confirm the `email` schema records was written.
        expect(queryResult.status.code).to.equal(200);
        expect(queryResult.records).to.exist;
        expect(queryResult.records!.length).to.equal(1);
        const [ aliceAgentRecord ] = queryResult!.records!;
        expect(await aliceAgentRecord.data.text()).to.equal(dataString);

        // Alice writes the message to her remote DWN.
        const { status } = await writeResult.record!.send(alice.did);
        expect(status.code).to.equal(202);

        // Query Alice's remote DWN for `plain/text` records.
        const aliceRemoteQueryResult = await dwn.records.query({
          from    : alice.did,
          message : {
            filter: {
              dataFormat: 'text/plain'
            }
          }
        });

        // Confirm `email` schema record was written to Alice's remote DWN.
        expect(aliceRemoteQueryResult.status.code).to.equal(200);
        expect(aliceRemoteQueryResult.records).to.exist;
        expect(aliceRemoteQueryResult.records!.length).to.equal(1);
        const [ aliceRemoteEmailRecord ] = aliceRemoteQueryResult!.records!;
        expect(await aliceRemoteEmailRecord.data.text()).to.equal(dataString);
      });
    });
  });

  describe('toJSON()', () => {
    it('should return all defined properties', async () => {
      // RecordOptions properties
      const author = alice.did;
      const target = alice.did;

      // Retrieve `#dwn` service entry.
      const [ didDwnService ] = didUtils.getServices({ didDocument: aliceDid.document, id: '#dwn' });

      // Retrieve first message signing key from the #dwn service endpoint.
      if (!didUtils.isDwnServiceEndpoint(didDwnService.serviceEndpoint)) throw Error('Type guard');
      const [ signingKeyIdFragment ] = didDwnService!.serviceEndpoint!.signingKeys;
      const [ encryptionKeyIdFragment ] = didDwnService!.serviceEndpoint!.encryptionKeys;

      const signingKeyId = `${alice.did}${signingKeyIdFragment}`;
      const signingKeyPair = aliceDid.keySet.verificationMethodKeys!.find(keyPair => keyPair.publicKeyJwk.kid === signingKeyIdFragment);
      const signingPrivateKeyJwk = signingKeyPair.privateKeyJwk;

      const encryptionKeyId = `${alice.did}${encryptionKeyIdFragment}`;
      const encryptionPublicKeyJwk = aliceDid.keySet.verificationMethodKeys!.find(keyPair => keyPair.publicKeyJwk.kid === encryptionKeyIdFragment)!.publicKeyJwk;

      // RecordsWriteMessage properties that can be pre-defined
      const attestation = [new PrivateKeySigner({
        privateJwk : signingPrivateKeyJwk as DwnPrivateKeyJwk,
        algorithm  : signingPrivateKeyJwk.alg as string,
        keyId      : signingKeyId,
      })];

      const authorization = new PrivateKeySigner({
        privateJwk : signingPrivateKeyJwk as DwnPrivateKeyJwk,
        algorithm  : signingPrivateKeyJwk.alg as string,
        keyId      : signingKeyId,
      });

      const encryptionInput: EncryptionInput = {
        algorithm            : EncryptionAlgorithm.Aes256Ctr,
        initializationVector : TestDataGenerator.randomBytes(16),
        key                  : TestDataGenerator.randomBytes(32),
        keyEncryptionInputs  : [{
          algorithm        : EncryptionAlgorithm.EciesSecp256k1,
          derivationScheme : KeyDerivationScheme.ProtocolPath,
          publicKey        : encryptionPublicKeyJwk as DwnPublicKeyJwk,
          publicKeyId      : encryptionKeyId
        }]
      };

      // RecordsWriteDescriptor properties that can be pre-defined
      const protocol = emailProtocolDefinition.protocol;
      const protocolPath = 'email';
      const schema = emailProtocolDefinition.types.email.schema;
      const recipient = alice.did;
      const published = true;

      // Install a protocol on Alice's agent connected DWN.
      await dwn.protocols.configure({
        message: {
          definition: emailProtocolDefinition
        }
      });

      // Create a parent record to reference in the RecordsWriteMessage used for validation
      const parentRecorsWrite = await RecordsWrite.create({
        data   : new Uint8Array(await dataBlob.arrayBuffer()),
        dataFormat,
        protocol,
        protocolPath,
        schema,
        signer : authorization,
      }) as RecordsWriteTest;

      // Create a RecordsWriteMessage
      const recordsWrite = await RecordsWrite.create({
        attestationSigners : attestation,
        data               : new Uint8Array(await dataBlob.arrayBuffer()),
        dataFormat,
        encryptionInput,
        parentId           : parentRecorsWrite.recordId,
        protocol,
        protocolPath,
        published,
        recipient,
        schema,
        signer             : authorization,
      }) as RecordsWriteTest;

      // Create record using test RecordsWriteMessage.
      const record = new Record(testAgent.agent, {
        ...recordsWrite.message,
        encodedData: dataBlob,
        target,
        author,
      });

      // Call toJSON() method.
      const recordJson = record.toJSON();

      // Retained Record properties.
      expect(recordJson.author).to.equal(author);
      expect(recordJson.target).to.equal(target);

      // Retained RecordsWriteMessage top-level properties.
      expect(record.contextId).to.equal(recordsWrite.message.contextId);
      expect(record.id).to.equal(recordsWrite.message.recordId);
      expect(record.encryption).to.not.be.undefined;
      expect(record.encryption).to.deep.equal(recordsWrite.message.encryption);
      expect(record.encryption!.keyEncryption.find(key => key.derivationScheme === KeyDerivationScheme.ProtocolPath));
      expect(record.attestation).to.not.be.undefined;
      expect(record.attestation).to.have.property('signatures');

      // Retained RecordsWriteDescriptor properties.
      expect(recordJson.interface).to.equal(DwnInterfaceName.Records);
      expect(recordJson.method).to.equal(DwnMethodName.Write);
      expect(recordJson.protocol).to.equal(protocol);
      expect(recordJson.protocolPath).to.equal(protocolPath);
      expect(recordJson.recipient).to.equal(recipient);
      expect(recordJson.schema).to.equal(schema);
      expect(recordJson.parentId).to.equal(parentRecorsWrite.recordId);
      expect(recordJson.dataCid).to.equal(recordsWrite.message.descriptor.dataCid);
      expect(recordJson.dataSize).to.equal(recordsWrite.message.descriptor.dataSize);
      expect(recordJson.dateCreated).to.equal(recordsWrite.message.descriptor.dateCreated);
      expect(recordJson.messageTimestamp).to.equal(recordsWrite.message.descriptor.messageTimestamp);
      expect(recordJson.published).to.equal(published);
      expect(recordJson.datePublished).to.equal(recordsWrite.message.descriptor.datePublished);
      expect(recordJson.dataFormat).to.equal(dataFormat);
    });
  });

  describe('update()', () => {
    it('updates a record', async () => {
      const { status, record } = await dwn.records.write({
        data    : 'Hello, world!',
        message : {
          schema     : 'foo/bar',
          dataFormat : 'text/plain'
        }
      });

      const dataCidBeforeDataUpdate = record!.dataCid;

      expect(status.code).to.equal(202);
      expect(record).to.not.be.undefined;

      const updateResult = await record!.update({ data: 'bye' });
      expect(updateResult.status.code).to.equal(202);

      const readResult = await dwn.records.read({
        message: {
          filter: {
            recordId: record!.id
          }
        }
      });

      expect(readResult.status.code).to.equal(200);
      expect(readResult.record).to.not.be.undefined;

      expect(readResult.record.dataCid).to.not.equal(dataCidBeforeDataUpdate);
      expect(readResult.record.dataCid).to.equal(record!.dataCid);

      const updatedData = await record!.data.text();
      expect(updatedData).to.equal('bye');
    });

    it('throws an exception when an immutable property is modified', async () => {
      const { status, record } = await dwn.records.write({
        data    : 'Hello, world!',
        message : {
          schema     : 'foo/bar',
          dataFormat : 'text/plain'
        }
      });

      expect(status.code).to.equal(202);
      expect(record).to.not.be.undefined;

      // @ts-expect-error because this test intentionally specifies an immutable property that is not present in RecordUpdateOptions.
      await expect(record!.update({ dataFormat: 'application/json' })).to.eventually.be.rejectedWith('is an immutable property. Its value cannot be changed.');
    });
  });
});
