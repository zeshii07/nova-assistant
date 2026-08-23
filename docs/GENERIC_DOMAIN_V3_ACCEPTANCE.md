# Generic Domain Framework v3.0 Acceptance

Acceptance requires:
- all inherited Nova tests pass
- all shipped conversation datasets pass
- restaurant menu browsing works through `offering`
- restaurant table reservation works through `booking`
- salon service appointment works through the same `booking`
- healthcare consultation works through the same `booking`
- education programs browse through `offering`
- education admission inquiry starts through `booking`
- strict entity resolver never upgrades a near match to exact
- cancel clears generic booking state
- domain schemas provide reusable semantics
- knowledge repository services/highlights can bootstrap informational offerings
