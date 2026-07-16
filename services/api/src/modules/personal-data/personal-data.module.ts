import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DeviceCredentialService } from "./device-credential.service.js";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";
import { PersonalDataConfigService } from "./personal-data-config.js";
import { PersonalDataIndexService } from "./personal-data-index.service.js";

@Module({
  imports: [ConfigModule],
  providers: [
    DeviceCredentialService,
    PersonalDataCipherService,
    PersonalDataConfigService,
    PersonalDataIndexService,
  ],
  exports: [
    DeviceCredentialService,
    PersonalDataCipherService,
    PersonalDataConfigService,
    PersonalDataIndexService,
  ],
})
export class PersonalDataModule {}
