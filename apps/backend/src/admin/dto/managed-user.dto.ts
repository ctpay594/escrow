import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateManagedUserDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(2)
  merchant_name!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  demo_balance?: number;
}

export class UpdateManagedUsernameDto {
  @IsString()
  @MinLength(3)
  username!: string;
}

export class ResetManagedPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;
}

export class UpdateDemoBalanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  demo_balance!: number;
}

export class UpdateBalanceModeDto {
  @IsIn(['real', 'demo'])
  balance_mode!: 'real' | 'demo';
}

export class UpdateApprovalModeDto {
  @IsIn(['auto', 'manual'])
  approval_mode!: 'auto' | 'manual';
}

export class UpdateAccountStatusDto {
  @IsIn(['active', 'on_hold', 'terminated'])
  account_status!: 'active' | 'on_hold' | 'terminated';
}
