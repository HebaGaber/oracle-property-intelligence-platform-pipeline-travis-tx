# Atlas registration

**Public by CID; Atlas registration pending.**

Run 1's data is published and independently verifiable on public IPFS (Filebase pin,
manifest CID `bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu`, readable from two
independent gateways: Filebase's own gateway and Pinata's public gateway). It is not yet
registered with the Elephant Atlas index.

This is a recorded limitation (P0-4), not an oversight: this assessment environment has no
Atlas access (no official application was filed — see the project's "no official requests"
posture). The county's data is fully public and verifiable by CID in the meantime; Atlas
registration can follow once access exists.

## Durability

- **Primary pin:** Filebase (Kubo RPC), with CLI readback confirmed on upload.
- **Backup:** every CAR file attached to a GitHub Release on this fork, so anyone can re-pin
  them independently.
- **Verification:** `scripts/verify-manifest.ts` fetches every artifact from two independent
  gateways (Filebase's and Pinata's) and checks size + SHA-256 against the manifest.
- **Known gap, tracked for a later phase:** a genuine third-party *second pin* (not just a
  read-only gateway) was investigated for Run 1 and found not viable on Pinata's free plan —
  pin-by-CID is a paid-only feature there, and the free-plan upload fallback assigns an
  unrelated CID to the raw file bytes rather than preserving the CAR's real root CID. The
  options for a real second pin (a self-hosted Kubo node kept online, or a paid Pinata plan)
  are recorded in `specs/011-publish-and-runs/run-log.md` as follow-up work, not blocking this
  run's publication.
