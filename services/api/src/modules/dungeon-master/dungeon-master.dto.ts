import { IsString, IsArray, IsNumber, IsOptional, Min, Max, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({ example: '019abc...', description: 'Scenario ID to use' })
  @IsString()
  scenarioId: string;

  @ApiProperty({
    example: ['user-id-1', 'user-id-2'],
    description: 'Array of exactly 2 user IDs',
  })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  participants: string[];
}

export class SubmitResponseDto {
  @ApiProperty({ example: 'I approach the mystery guest carefully...' })
  @IsString()
  @Min(1)
  @Max(300)
  content: string;
}

export class DMScenarioDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  archetype: string;
  @ApiProperty()
  description: string;
  @ApiProperty()
  openingText: string;
  @ApiProperty()
  scenes: object[];
  @ApiProperty()
  xpReward: number;
  @ApiProperty()
  totalScenes: number;
}

export class DebriefDto {
  @ApiProperty()
  narrative: string;
  @ApiProperty()
  connectionHighlights: string[];
  @ApiProperty()
  xpAwarded: number;
  @ApiProperty()
  recommendedNextSteps: string[];
}

export class DMSessionDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  scenarioId: string;
  @ApiProperty()
  scenario: DMScenarioDto;
  @ApiProperty()
  participants: string[];
  @ApiProperty()
  currentScene: number;
  @ApiProperty()
  status: string;
  @ApiProperty()
  currentNarrative: string | null;
  @ApiPropertyOptional()
  sceneStartedAt: Date | null;
  @ApiPropertyOptional()
  debrief: DebriefDto | null;
  @ApiPropertyOptional()
  debriefStartedAt: Date | null;
  @ApiPropertyOptional()
  xpAwardedAt: Date | null;
  @ApiProperty()
  startedAt: Date | null;
  @ApiProperty()
  deadline: Date | null;
  @ApiProperty()
  createdAt: Date;
  @ApiProperty()
  responses: DMSceneResponseDto[];
}

export class DMSceneResponseDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  sessionId: string;
  @ApiProperty()
  userId: string;
  @ApiProperty()
  sceneIndex: number;
  @ApiProperty()
  content: string;
  @ApiProperty()
  submittedAt: Date;
}

export class DMSessionListDto {
  @ApiProperty()
  sessions: DMSessionDto[];
  @ApiProperty()
  total: number;
}

// Prompt injection DTOs
export class ScenePromptContext {
  scenarioName: string;
  scenarioArchetype: string;
  setting: string;
  userA: {
    id: string;
    name: string | null;
  };
  userB: {
    id: string;
    name: string | null;
  };
  sceneIndex: number;
  totalScenes: number;
  sceneDescription: string;
  userAResponse: string | null;
  userBResponse: string | null;
}
