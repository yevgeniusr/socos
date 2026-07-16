import { AGENT_SCOPES, type AgentScope } from "@socos/agent-core";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class CreateAgentClientDto {
  @IsString()
  @Length(1, 80)
  @Matches(/\S/)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AGENT_SCOPES.length)
  @ArrayUnique()
  @IsIn(AGENT_SCOPES, { each: true })
  scopes!: AgentScope[];

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  expiresAt?: string;
}
