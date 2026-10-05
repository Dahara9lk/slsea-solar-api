# SLSEA Solar API Rules
- Domain: Province -> District -> Substation -> SolarInstallation -> GenerationReading.
- CRITICAL: `meter_id` is an attribute of SolarInstallation. DO NOT create a Device entity.
- CRITICAL: GenerationReading is an append-only time-series. DO NOT put `last_power` on the installation.
- REST Rules: Lowercase, hyphens, plural nouns. No verbs in URIs.
- Security: Devices WRITE (auth as installation). Users READ (auth by jurisdiction).