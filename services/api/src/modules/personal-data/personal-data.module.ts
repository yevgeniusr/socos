import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";
import { PersonalDataIndexService } from "./personal-data-index.service.js";

@Module({
  imports: [ConfigModule],
  providers: [PersonalDataCipherService, PersonalDataIndexService],
  exports: [PersonalDataCipherService, PersonalDataIndexService],
})
export class PersonalDataModule {}
