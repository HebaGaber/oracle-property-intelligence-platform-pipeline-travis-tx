// CountyLensCert (stub, A-03 T018). Filled in W3 (G-A5): only the Amplify custom-domain
// association (CfnDomain countylens.aldarraj.com, AMPLIFY_MANAGED certificate, no root domain).
// Deployed last (AM-02) because it needs the Web app and branch; no ACM, no Route 53 (AD-13).
import { Stack } from "aws-cdk-lib";

export class CertStack extends Stack {
  // Intentionally empty this wave: resources and props arrive with the W3 domain task.
}
