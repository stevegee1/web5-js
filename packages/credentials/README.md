# Credentials

The Credentials package enables the creation, signing, verification, and general processing of `Verifiable Credentials` (VCs). It also has full `Presentation Exchange` support.

## Verifiable Credential

### Features

- Create Verifiable Credentials with flexible data types.
- Sign credentials using decentralized identifiers (DIDs).
- Verify the integrity and authenticity of VCs encoded as JSON Web Tokens (JWTs).
- Parse JWT representations of VCs into `VerifiableCredential` instances.

### Usage:
### Creating a Verifiable Credential

Create a new `VerifiableCredential` with the following parameters:

- `type`: Type of the credential.
- `issuer`: Issuer URI.
- `subject`: Subject URI.
- `data`: Credential data.
- `expirationDate?`: (optinal) Expiration Date

```javascript
class StreetCredibility {
  constructor(localRespect, legit) {
    this.localRespect = localRespect;
    this.legit = legit;
  }
}

const vc = new VerifiableCredential({
  type: "StreetCred",
  issuer: "did:example:issuer",
  subject: "did:example:subject",
  data: new StreetCredibility("high", true)
});
```

### Signing a Verifiable Credential
Sign a `VerifiableCredential` with a DID:

- `signOptions`: The sign options used to sign the credential.

First create a SignOptions object as follows:
```javascript
import { Ed25519, Jose } from '@web5/crypto';
import { DidKeyMethod } from '@web5/dids';

const issuer = await DidKeyMethod.create();
const privateKey = (await Jose.jwkToKey({ key: issuer.keySet.verificationMethodKeys![0].privateKeyJwk! })).keyMaterial;

const signOptions = {
  issuerDid: issuer.did,
  subjectDid: "did:example:subject",
  kid: `${issuer.did}#${issuer.did.split(':')[2]}`,
  signer: async (data) => await Ed25519.sign({ data, key: privateKey })
};
```

Then sign the VC using the signoptions object
```javascript
const vcJwt = vc.sign(signOptions)
```

### Verifying a Verifiable Credential
Verify the integrity and authenticity of a VC JWT

- `vcJwt`: The VC in JWT format as a String.
```javascript
try {
  await VerifiableCredential.verify(vcJwt)
  console.log("VC Verification successful!")
} catch (e: Error) {
  console.log("VC Verification failed: ${e.message}")
}
```

### Parsing a JWT into a Verifiable Credential
Parse a JWT into a `VerifiableCredential` instance

`vcJwt`: The VC JWT as a String.

```javascript
const vc = VerifiableCredential.parseJwt(vcJwt)
```

## Presentation Exchange

`PresentationExchange` is designed to facilitate the creation of a Verifiable Presentation by providing tools to select and validate Verifiable Credentials against defined criteria.

### Features

- Select credentials that satisfy a given presentation definition.
- Validate if a Verifiable Credential JWT satisfies a Presentation Definition.
- Validate input descriptors within Verifiable Credentials.


### Usage

### Selecting Credentials
Select Verifiable Credentials that meet the criteria of a given presentation definition.

- `vcJwts`: The list of Verifiable Credentials to select from.
- `presentationDefinition` The Presentation Definition to match against.

This returns a list of the vcJwts that are acceptable in the presentation definition.
```javascript
const selectedCredentials = PresentationExchange.selectCredentials(
    vcJwts,
    presentationDefinition
)
```

### Satisfying a Presentation Definition
Validate if a Verifiable Credential JWT satisfies the given presentation definition. Will return an error if the evaluation results in warnings or errors.

- `vcJwts`: The list of Verifiable Credentials to select from.
- `presentationDefinition` The Presentation Definition to match against.

```javascript 
try {
  PresentationExchange.satisfiesPresentationDefinition(vcJwts, presentationDefinition)
  console.log("vcJwts satisfies Presentation Definition!")
} catch (e: Error) {
  console.log("Verification failed: ${e.message}")
}


```

### Create Presentation From Credentials
Creates a presentation from a list of Verifiable Credentials that satisfy a given presentation definition. This function initializes the Presentation Exchange (PEX) process, validates the presentation definition, evaluates the credentials against the definition, and finally constructs the presentation result if the evaluation is successful.

- `vcJwts`: The list of Verifiable Credentials to select from.
- `presentationDefinition` The Presentation Definition to match against.

```javascript
const presentationResult = PresentationExchange.createPresentationFromCredentials(vcJwts, presentationDefinition)
```

### Validate Definition
This method validates whether an object is usable as a presentation definition or not.

```javascript
const valid = PresentationExchange.validateDefinition(presentationDefinition)
```

### Validate Submission
This method validates whether an object is usable as a presentation submission or not.

```javascript
const valid = PresentationExchange.validateSubmission(presentationSubmission)
```

### Validate Presentation
Evaluates a presentation against a presentation definition.

```javascript
const evaluationResults = PresentationExchange.evaluatePresentation(presentationDefinition, presentation)
```