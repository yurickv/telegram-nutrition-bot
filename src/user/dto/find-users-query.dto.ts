import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum SortOrder {
    Asc = 'asc',
    Desc = 'desc',
}

export class FindUsersQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;

    @IsOptional()
    @IsDateString()
    firstInitFrom?: string;

    @IsOptional()
    @IsDateString()
    firstInitTo?: string;

    @IsOptional()
    @IsEnum(SortOrder)
    sortOrder?: SortOrder;
}
