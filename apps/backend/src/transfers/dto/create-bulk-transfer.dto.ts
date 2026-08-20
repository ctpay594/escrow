import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { PayoutMode } from '../transfers.types';

const PAYOUT_MODES = ['IMPS', 'NEFT', 'RTGS', 'UPI'] as const;

export class BulkTransferItemDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;

  @IsIn(PAYOUT_MODES)
  payout_mode: PayoutMode = 'IMPS';

  @IsOptional()
  @IsString()
  transaction_note?: string;

  @IsString()
  @MinLength(2)
  beneficiary_account_name!: string;

  @ValidateIf((dto: BulkTransferItemDto) => dto.payout_mode !== 'UPI')
  @IsString()
  @MinLength(6)
  beneficiary_account_no?: string;

  @ValidateIf((dto: BulkTransferItemDto) => dto.payout_mode !== 'UPI')
  @IsString()
  @MinLength(11)
  beneficiary_ifsc?: string;

  @ValidateIf((dto: BulkTransferItemDto) => dto.payout_mode === 'UPI')
  @IsString()
  @MinLength(5)
  beneficiary_vpa?: string;
}

export class CreateBulkTransferDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkTransferItemDto)
  transfers!: BulkTransferItemDto[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;
}
