import { IsOptional, IsString } from 'class-validator';

export class ExtractEmailDto {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  path?: string;
}

