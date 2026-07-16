import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";

@Module({
  imports: [ConfigModule],
  providers: [PersonalDataCipherService],
  exports: [PersonalDataCipherService],
})
export class PersonalDataModule {}
